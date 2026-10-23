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
import { type RebuildResult, rebuildRunLocked } from "./cache.js";
import { detectTool } from "./detect.js";
import { fromZod, RelayError } from "./error.js";
import { isEnoent, readJson } from "./files.js";
import { gitProgram, treeStatus } from "./git.js";
import { appendEvent } from "./mutate.js";
import { readPolicy, validateWorktreeDir } from "./policy.js";
import { type RunJson, runJsonSchema } from "./run.js";
import { acquireRunLock, releaseRunLock } from "./runlock.js";
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

// One worktree and branch for a claimed task. The branch name is `<run>-<task>`.
export async function addTaskWorktree(input: {
  root: string;
  relayDir: string;
  dir: string | undefined;
  runName: string;
  task: string;
  head: string;
}): Promise<WorktreeRecord> {
  const branch = `${input.runName}-${input.task}`;
  const parent = input.dir === undefined
    ? join(dirname(input.root), `${basename(input.root)}_work-tree`)
    : resolve(input.root, input.dir);
  const path = join(parent, input.runName, input.task);
  if (await pathExists(path)) throw new RelayError("gate", "worktree path already exists", path);
  if (await branchExists(input.root, branch)) {
    throw new RelayError("gate", "worktree branch already exists", branch);
  }
  await validateWorktreeDir(input.root, input.dir);
  await mkdir(join(parent, input.runName), { recursive: true });
  try {
    await gitOut(input.root, ["worktree", "add", "-b", branch, path, input.head]);
  } catch (error) {
    if (await branchExists(input.root, branch)) {
      await gitOut(input.root, ["branch", "-D", branch]).catch(() => undefined);
    }
    if (await pathExists(path)) {
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
    }
    throw new RelayError("gate", `git worktree add failed: ${gitMessage(error)}`, path);
  }
  try {
    await linkRelay(path, input.relayDir);
    await excludeRelay(input.root);
  } catch (error) {
    await rollbackWorktree(input.root, path, branch);
    throw error;
  }
  return { path, branch };
}

// Remove a clean task worktree and its branch. Keep a dirty worktree.
export async function releaseTaskWorktree(
  root: string,
  record: WorktreeRecord,
  checkout: string,
): Promise<WorktreeRemoval> {
  try {
    await gitOut(checkout, ["merge-base", "--is-ancestor", record.branch, "HEAD"]);
  } catch {
    return { removed: false, reason: "branch has unmerged commits" };
  }
  if (!await pathExists(record.path)) {
    await gitOut(root, ["branch", "-D", record.branch]).catch(() => undefined);
    return { removed: true };
  }
  let status: string;
  try {
    status = await treeStatus(record.path);
  } catch {
    return { removed: false, reason: "worktree status failed" };
  }
  if (status.length > 0) return { removed: false, reason: "worktree has changes" };
  const link = join(record.path, relayName);
  try {
    await unlink(link);
  } catch (error) {
    if (!isEnoent(error)) {
      const message = error instanceof Error ? error.message : String(error);
      return { removed: false, reason: `unlink .agent-relay failed: ${message}` };
    }
  }
  try {
    await gitOut(root, ["worktree", "remove", record.path]);
  } catch (error) {
    return { removed: false, reason: `git worktree remove failed: ${gitMessage(error)}` };
  }
  await gitOut(root, ["branch", "-D", record.branch]).catch(() => undefined);
  return { removed: true };
}

// Merge `branch` into the checkout. A conflict aborts the merge and returns the paths.
export async function mergeTaskBranch(
  checkout: string,
  branch: string,
): Promise<{ merged: true } | { merged: false; paths: string[] }> {
  try {
    await gitOut(checkout, ["merge", "--no-edit", branch]);
    return { merged: true };
  } catch (error) {
    let names = "";
    try {
      names = await gitOut(checkout, ["diff", "--name-only", "--diff-filter=U"]);
    } catch {
      names = "";
    }
    const paths = names.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    if (paths.length === 0) {
      throw new RelayError("gate", `git merge failed: ${gitMessage(error)}`, branch);
    }
    await gitOut(checkout, ["merge", "--abort"]).catch(() => undefined);
    return { merged: false, paths };
  }
}

// The branch point tree, so `task done` can see edits in the task worktree.
export async function taskWorktreeBase(
  runDir: string,
  run: RunJson,
  task: string,
): Promise<{ cwd: string; from: string } | undefined> {
  const record = await taskWorktreeRecord(runDir, run, task);
  if (record === undefined) return undefined;
  const runCwd = await runGitCwd(runDir, run);
  let base: string;
  try {
    const runHead = (await gitOut(runCwd, ["rev-parse", "HEAD"])).trim();
    base = (await gitOut(record.path, ["merge-base", runHead, record.branch])).trim();
  } catch (error) {
    throw new RelayError("validation", `task worktree base not found: ${gitMessage(error)}`, task);
  }
  try {
    const from = (await gitOut(record.path, ["rev-parse", `${base}^{tree}`])).trim();
    return { cwd: record.path, from };
  } catch (error) {
    throw new RelayError("validation", `task worktree tree not found: ${gitMessage(error)}`, task);
  }
}

export async function taskWorktreeRecord(
  runDir: string,
  run: RunJson,
  task: string,
): Promise<WorktreeRecord | undefined> {
  const located = await taskWorktreeParent(runDir, run);
  if (located === undefined) return undefined;
  const path = join(located.parent, located.runName, task);
  if (!await pathExists(path)) return undefined;
  return { path, branch: `${located.runName}-${task}` };
}

export async function openTaskWorktrees(
  runDir: string,
  run: RunJson,
  tasks: readonly string[],
): Promise<string[]> {
  const located = await taskWorktreeParent(runDir, run);
  if (located === undefined) return [];
  const ids: string[] = [];
  for (const task of tasks) {
    if (await pathExists(join(located.parent, located.runName, task))) ids.push(task);
  }
  return ids;
}

async function taskWorktreeParent(
  runDir: string,
  run: RunJson,
): Promise<{ parent: string; runName: string } | undefined> {
  const cwd = await runGitCwd(runDir, run);
  let policy;
  try {
    policy = await readPolicy(cwd, run.base);
  } catch (error) {
    if (error instanceof RelayError) return undefined;
    throw error;
  }
  if (policy.worktree?.enabled !== true) return undefined;
  const relayDir = await realpath(dirname(runDir));
  const root = dirname(relayDir);
  const parent = policy.worktree.dir === undefined
    ? join(dirname(root), `${basename(root)}_work-tree`)
    : resolve(root, policy.worktree.dir);
  return { parent, runName: basename(runDir) };
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

async function withWorktreeCleanupLock<T>(
  runDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await acquireRunLock(runDir);
  try {
    return await fn();
  } finally {
    await releaseRunLock(lock);
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
    const loaded = await rebuildRunLocked(runDir);
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
