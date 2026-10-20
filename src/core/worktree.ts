import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { type RebuildResult, rebuildRun } from "./cache.js";
import { detectTool } from "./detect.js";
import { fromZod, RelayError } from "./error.js";
import { isEnoent, readJson } from "./files.js";
import { gitProgram, treeStatus } from "./git.js";
import { appendEvent } from "./mutate.js";
import { readPolicy, validateWorktreeDir } from "./policy.js";
import { type RunJson, runJsonSchema } from "./run.js";
import { schemaVersion } from "./vocab.js";

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

export type WorktreeListEntry = {
  path: string;
  head: string;
  branch?: string;
  detached?: boolean;
  bare?: boolean;
};

function pushValidEntry(
  entries: WorktreeListEntry[],
  current: Partial<WorktreeListEntry> | null,
): void {
  if (current?.path !== undefined && current.head !== undefined) {
    entries.push(current as WorktreeListEntry);
  }
}

function parseWorktreeLine(
  line: string,
  current: Partial<WorktreeListEntry>,
): void {
  if (line.startsWith("HEAD ")) {
    current.head = line.slice("HEAD ".length);
  } else if (line.startsWith("branch ")) {
    current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
  } else if (line === "detached") {
    current.detached = true;
  } else if (line === "bare") {
    current.bare = true;
  }
}

export async function listWorktrees(root: string): Promise<WorktreeListEntry[]> {
  const stdout = await gitOut(root, ["worktree", "list", "--porcelain"]);
  const entries: WorktreeListEntry[] = [];
  let current: Partial<WorktreeListEntry> | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      pushValidEntry(entries, current);
      current = { path: line.slice("worktree ".length) };
    } else if (current !== null) {
      parseWorktreeLine(line, current);
    }
  }
  pushValidEntry(entries, current);
  return entries;
}

export async function validateRunWorktree(
  runDir: string,
  worktree: WorktreeRecord,
): Promise<void> {
  let canonicalWorktreePath: string;
  try {
    canonicalWorktreePath = await realpath(worktree.path);
  } catch (error) {
    if (isEnoent(error)) {
      throw new RelayError("gate", "worktree not found", "worktree.path");
    }
    throw error;
  }

  const root = await mainRoot(runDir);
  const entries = await listWorktrees(root);
  let matched: WorktreeListEntry | undefined;
  for (const entry of entries) {
    try {
      if (await realpath(entry.path) === canonicalWorktreePath) {
        matched = entry;
        break;
      }
    } catch {
      continue;
    }
  }

  if (matched === undefined) {
    throw new RelayError("gate", "worktree is not registered with the repository", "worktree.path");
  }

  if (matched.detached === true) {
    throw new RelayError("gate", "worktree HEAD is detached", "worktree.path");
  }

  const runName = basename(runDir);
  if (matched.branch !== runName) {
    throw new RelayError(
      "gate",
      `worktree branch is ${matched.branch ?? "none"}, expected ${runName}`,
      "worktree.branch",
    );
  }
}

// The worktree sees the main repo run history through a link, so runs stay in one place.
export async function linkRelay(
  worktreePath: string,
  relayDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const link = join(worktreePath, relayName);
  try {
    await lstat(link);
    throw new RelayError("gate", "worktree .agent-relay already exists", relayName);
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  await symlink(resolve(relayDir), link, platform === "win32" ? "junction" : "dir");
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

// Roll back a created worktree, its relay symlink, and its branch.
export async function rollbackWorktree(
  root: string,
  path: string,
  branchName: string,
): Promise<void> {
  const link = join(path, relayName);
  try {
    await unlink(link);
  } catch (error) {
    if (!isEnoent(error)) await rm(link, { force: true }).catch(() => undefined);
  }
  await gitOut(root, ["worktree", "remove", "--force", path]).catch(() => undefined);
  await gitOut(root, ["branch", "-D", branchName]).catch(() => undefined);
  if (await pathExists(path)) {
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
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
  await validateWorktreeDir(root, settings.dir);
  await mkdir(dir, { recursive: true });
  try {
    await gitOut(root, ["worktree", "add", "-b", input.name, path, input.head]);
  } catch (error) {
    if (await branchExists(root, input.name)) {
      await gitOut(root, ["branch", "-D", input.name]).catch(() => undefined);
    }
    if (await pathExists(path)) {
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
    }
    throw new RelayError("gate", `git worktree add failed: ${gitMessage(error)}`, path);
  }
  try {
    await linkRelay(path, relayDir);
    await excludeRelay(root);
  } catch (error) {
    await rollbackWorktree(root, path, input.name);
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
  let unlinked = false;
  try {
    await unlink(link);
    unlinked = true;
  } catch (error) {
    if (!isEnoent(error)) {
      const message = error instanceof Error ? error.message : String(error);
      return { removed: false, reason: `unlink .agent-relay failed: ${message}` };
    }
  }
  try {
    await gitOut(root, ["worktree", "remove", run.worktree.path]);
  } catch (error) {
    if (unlinked) {
      await linkRelay(run.worktree.path, join(root, relayName)).catch(() => undefined);
    }
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

export type WorktreeCleanupResult = {
  schema: 1;
  path: string;
  worktree: WorktreeRemoval;
};

export function worktreeCleanupText(result: WorktreeCleanupResult): string {
  if (result.worktree.removed) return "worktree: removed\n";
  return `worktree: kept (${result.worktree.reason ?? "unknown"})\n`;
}

async function tryAcquireCleanupLock(lockPath: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        host: hostname() || "unknown",
        ts: new Date().toISOString(),
      }) + "\n",
    );
    await handle.close();
    return true;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (handle !== undefined) {
      await rm(lockPath, { force: true });
      throw error;
    }
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
    if (code !== "EEXIST" && code !== "EPERM") throw error;
    return false;
  }
}

async function clearStaleCleanupLock(lockPath: string): Promise<void> {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs >= 30_000) {
      await rm(lockPath, { force: true });
    }
  } catch (staleError) {
    const staleCode = staleError instanceof Error && "code" in staleError
        && typeof staleError.code === "string"
      ? staleError.code
      : "";
    if (staleCode !== "ENOENT") throw staleError;
  }
}

async function acquireCleanupLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await tryAcquireCleanupLock(lockPath))) {
    if (Date.now() >= deadline) {
      throw new RelayError("lock", "run lock timed out", "locks/run.lock");
    }
    await clearStaleCleanupLock(lockPath);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function withWorktreeCleanupLock<T>(
  runDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockDir = join(runDir, "locks");
  const lockPath = join(lockDir, "run.lock");
  await mkdir(lockDir, { recursive: true });
  await acquireCleanupLock(lockPath);
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

function assertCleanupEligible(loaded: RebuildResult): void {
  if (loaded.run.worktree === undefined) {
    throw new RelayError("gate", "run has no worktree", "worktree");
  }
  if (loaded.run.state.lifecycle !== "closed") {
    throw new RelayError(
      "gate",
      `worktree cleanup refused: run is ${loaded.run.state.lifecycle}`,
      "state.lifecycle",
    );
  }
}

async function recordWorktreeCleaned(loaded: RebuildResult, runDir: string): Promise<void> {
  try {
    const actor = detectTool(process.env) === undefined ? "unknown" : "agent-env";
    await appendEvent(loaded, runDir, {
      stage: "run",
      action: "cleaned",
      actor,
    });
  } catch {
    // Swallow write failure to report removal
  }
}

async function handleMissingWorktree(
  loaded: RebuildResult,
  runDir: string,
): Promise<WorktreeRemoval> {
  const hasCleaned = loaded.events.some((e) => e.stage === "run" && e.action === "cleaned");
  if (!hasCleaned) {
    await recordWorktreeCleaned(loaded, runDir);
  }
  return { removed: true };
}

async function handleExistingWorktree(
  runDir: string,
  loaded: RebuildResult,
  worktree: WorktreeRecord,
): Promise<WorktreeRemoval> {
  try {
    await validateRunWorktree(runDir, worktree);
    const root = await mainRoot(runDir);
    const removal = await removeMergedWorktree(root, {
      name: basename(runDir),
      worktree,
    });
    if (removal.removed) {
      await recordWorktreeCleaned(loaded, runDir);
    }
    return removal;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { removed: false, reason: message };
  }
}

export async function cleanupWorktree(runDir: string): Promise<WorktreeCleanupResult> {
  return withWorktreeCleanupLock(runDir, async () => {
    const loaded = await rebuildRun(runDir);
    assertCleanupEligible(loaded);
    const worktree = loaded.run.worktree!;
    const exists = await pathExists(worktree.path);
    const removal = exists
      ? await handleExistingWorktree(runDir, loaded, worktree)
      : await handleMissingWorktree(loaded, runDir);
    return {
      schema: schemaVersion,
      path: runDir,
      worktree: removal,
    };
  });
}
