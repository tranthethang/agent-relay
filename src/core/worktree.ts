import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fromZod, RelayError } from "./error.js";
import { isEnoent, readJson } from "./files.js";
import { gitProgram, treeStatus } from "./git.js";
import { readPolicy } from "./policy.js";
import { type RunJson, runJsonSchema } from "./run.js";

const execFileAsync = promisify(execFile);
const relayName = ".agent-relay";

export type WorktreeRecord = { path: string; branch: string };

export type WorktreeSettings = { dir?: string; branch: string };

export type WorktreeRemoval = { removed: boolean; reason?: string };

// Git runs in the run worktree when run.json has one. Otherwise it runs from the run folder.
export async function gitCwd(runDir: string): Promise<string> {
  let value: unknown;
  try {
    value = await readJson(join(runDir, "run.json"));
  } catch (error) {
    if (isEnoent(error)) throw new RelayError("not_found", "run.json not found", "run.json");
    throw error;
  }
  const parsed = runJsonSchema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    const fieldPath = issue.fieldPath.length === 0 ? "run.json" : `run.json:${issue.fieldPath}`;
    throw new RelayError(issue.code, issue.message, fieldPath);
  }
  return runGitCwd(runDir, parsed.data);
}

export async function runGitCwd(runDir: string, run: RunJson): Promise<string> {
  if (run.worktree === undefined) return runDir;
  try {
    await stat(run.worktree.path);
  } catch (error) {
    if (isEnoent(error)) {
      throw new RelayError("not_found", "worktree not found", "run.json:worktree.path");
    }
    throw error;
  }
  return run.worktree.path;
}

// The worktree sees the main repo run history through a link, so runs stay in one place.
export async function linkRelay(worktreePath: string, relayDir: string): Promise<void> {
  const link = join(worktreePath, relayName);
  try {
    await lstat(link);
    throw new RelayError("gate", "worktree .agent-relay already exists", relayName);
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  await symlink(resolve(relayDir), link, process.platform === "win32" ? "junction" : "dir");
}

// The `.agent-relay/` pattern does not match a link, so ignore the bare name for every worktree.
export async function excludeRelay(root: string): Promise<void> {
  const common = await gitOut(root, ["rev-parse", "--git-common-dir"]);
  const infoDir = join(resolve(root, common.trim()), "info");
  const exclude = join(infoDir, "exclude");
  let text = "";
  try {
    text = await readFile(exclude, "utf8");
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  if (text.split(/\r?\n/).includes(relayName)) return;
  const prefix = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
  await mkdir(infoDir, { recursive: true });
  await writeFile(exclude, `${prefix}${relayName}\n`);
}

// Policy at HEAD decides. Uncommitted policy edits have no effect on a new run.
export async function worktreeSettings(
  cwd: string,
  head: string,
): Promise<WorktreeSettings | null> {
  const policy = await readPolicy(cwd, head);
  if (policy.worktree?.enabled !== true) return null;
  let branch: string;
  try {
    branch = (await gitOut(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
  } catch {
    branch = "";
  }
  if (branch.length === 0) throw new RelayError("gate", "worktree needs a branch at HEAD", "HEAD");
  return { ...(policy.worktree.dir === undefined ? {} : { dir: policy.worktree.dir }), branch };
}

// Create `<dir>/<name>` on a new branch `<name>`, link `.agent-relay`, and ignore the link.
// A failure removes the worktree and the branch again.
export async function addWorktree(
  settings: WorktreeSettings,
  input: { relayDir: string; name: string; head: string },
): Promise<WorktreeRecord> {
  const relayDir = await realpath(input.relayDir);
  const root = dirname(relayDir);
  const dir = settings.dir === undefined
    ? join(dirname(root), `${basename(root)}_work-tree`)
    : resolve(root, settings.dir);
  const path = join(dir, input.name);
  if (await pathExists(path)) throw new RelayError("gate", "worktree path already exists", path);
  if (await branchExists(root, input.name)) {
    throw new RelayError("gate", "worktree branch already exists", input.name);
  }
  await mkdir(dir, { recursive: true });
  try {
    await gitOut(root, ["worktree", "add", "-b", input.name, path, input.head]);
  } catch (error) {
    throw new RelayError("gate", `git worktree add failed: ${gitMessage(error)}`, path);
  }
  try {
    await linkRelay(path, relayDir);
    await excludeRelay(root);
  } catch (error) {
    await rm(join(path, relayName), { force: true }).catch(() => undefined);
    await gitOut(root, ["worktree", "remove", "--force", path]).catch(() => undefined);
    await gitOut(root, ["branch", "-D", input.name]).catch(() => undefined);
    throw error;
  }
  return { path, branch: settings.branch };
}

// The main repo root holds the real `.agent-relay/`. A run path through a worktree link resolves to it.
export async function mainRoot(runDir: string): Promise<string> {
  return dirname(dirname(await realpath(runDir)));
}

// `null` means merged. A string says why `close` keeps the worktree.
async function unmergedReason(
  root: string,
  name: string,
  record: WorktreeRecord,
): Promise<string | null> {
  try {
    await gitOut(root, ["merge-base", "--is-ancestor", name, record.branch]);
    return null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 1) {
      return `branch not merged into ${record.branch}`;
    }
    return `merge check failed: ${gitMessage(error)}`;
  }
}

// `null` means `close` can remove the worktree. A run branch with no new commits counts as
// merged, so uncommitted changes in the worktree also keep it.
export async function keepReason(
  root: string,
  name: string,
  record: WorktreeRecord,
): Promise<string | null> {
  const unmerged = await unmergedReason(root, name, record);
  if (unmerged !== null) return unmerged;
  let status: string;
  try {
    status = await treeStatus(record.path);
  } catch {
    return "worktree status failed";
  }
  return status.length > 0 ? "worktree has changes" : null;
}

// Remove the worktree only after the run branch is merged and the worktree is clean.
// Keep the branch and the run history.
export async function removeMergedWorktree(
  root: string,
  run: { name: string; worktree: WorktreeRecord },
): Promise<WorktreeRemoval> {
  const reason = await keepReason(root, run.name, run.worktree);
  if (reason !== null) return { removed: false, reason };
  const link = join(run.worktree.path, relayName);
  // Remove the link first, so `git worktree remove` cannot reach the real `.agent-relay/`.
  try {
    await unlink(link);
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  try {
    await gitOut(root, ["worktree", "remove", run.worktree.path]);
  } catch (error) {
    await linkRelay(run.worktree.path, join(root, relayName)).catch(() => undefined);
    return { removed: false, reason: `git worktree remove failed: ${gitMessage(error)}` };
  }
  return { removed: true };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

async function branchExists(root: string, name: string): Promise<boolean> {
  try {
    await gitOut(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
    return true;
  } catch {
    return false;
  }
}

async function gitOut(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync(gitProgram, args, { cwd })).stdout;
}

function gitMessage(error: unknown): string {
  const stderr = error instanceof Error && "stderr" in error ? String(error.stderr).trim() : "";
  return stderr.length > 0 ? stderr : "unknown error";
}
