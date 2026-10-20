import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test, vi } from "vitest";
import { RelayError } from "../src/core/error.js";
import {
  addWorktree,
  cleanupWorktree,
  excludeRelay,
  gitCwd,
  keepReason,
  linkRelay,
  listWorktrees,
  removeMergedWorktree,
  rollbackWorktree,
  runGitCwd,
  validateRunWorktree,
  worktreeCleanupText,
  worktreeSettings,
} from "../src/core/worktree.js";
import { gitCommit, withTempDir, withTempGitRepo } from "./helper.js";

type GitResult = { stdout: string; stderr: string };
type GitHook = (args: string[], cwd: string) => Promise<GitResult> | undefined;

const hooks = vi.hoisted(() => ({ git: null as GitHook | null }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const util = await import("node:util");
  const real = util.promisify(actual.execFile);
  const execFile = Object.assign(
    (...params: Parameters<typeof actual.execFile>) => actual.execFile(...params),
    {
      [util.promisify.custom]: (file: string, args: string[], options: { cwd: string }) =>
        hooks.git?.(args, options.cwd) ?? real(file, args, options),
    },
  );
  return { ...actual, execFile };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    open: vi.fn(actual.open),
    realpath: vi.fn(actual.realpath),
    stat: vi.fn(actual.stat),
    unlink: vi.fn(actual.unlink),
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, hostname: vi.fn(actual.hostname) };
});

const execFileAsync = promisify(execFile);
const runName = "20261020-1792208725-test";

const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

afterEach(() => {
  hooks.git = null;
  for (const mock of [fsp.lstat, fsp.open, fsp.realpath, fsp.stat, fsp.unlink, os.hostname]) {
    vi.mocked(mock).mockReset();
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function coded(code: unknown, message = "denied"): Error {
  return Object.assign(new Error(message), { code });
}

function runJson(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: 1,
    id: "1792208725",
    ymd: "20261020",
    slug: "test",
    title: "Test",
    base: "abc",
    state: { lifecycle: "closed", stage: "cross-review", approved: true, tasks: [] },
    ...extra,
  };
}

async function seedRun(
  runDir: string,
  extra: Record<string, unknown>,
  actions: string[] = ["closed"],
): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "run.json"), `${JSON.stringify(runJson(extra))}\n`);
  const lines = actions.map((action) =>
    JSON.stringify({ schema: 1, ts: "2026-10-20T00:00:00.000Z", stage: "run", action })
  );
  await writeFile(join(runDir, "events.jsonl"), lines.map((line) => `${line}\n`).join(""));
}

async function events(runDir: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(runDir, "events.jsonl"), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function head(dir: string): Promise<string> {
  return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
}

async function baseBranch(dir: string): Promise<string> {
  return (await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: dir })).stdout
    .trim();
}

// A repo with a real run worktree created by addWorktree.
async function withRunWorktree(
  fn: (ctx: { dir: string; runDir: string; path: string; branch: string }) => Promise<void>,
): Promise<void> {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    await withTempDir(async (outside) => {
      const relayDir = join(dir, ".agent-relay");
      const runDir = join(relayDir, runName);
      await mkdir(runDir, { recursive: true });
      const branch = await baseBranch(dir);
      const record = await addWorktree({ dir: outside, branch }, {
        relayDir,
        name: runName,
        head: await head(dir),
      });
      try {
        await fn({ dir, runDir, path: record.path, branch });
      } finally {
        await rollbackWorktree(dir, record.path, runName);
      }
    });
  });
}

test("gitCwd reports a missing run.json as not_found", async () => {
  await withTempDir(async (dir) => {
    await expect(gitCwd(dir)).rejects.toMatchObject({ code: "not_found", fieldPath: "run.json" });
  });
});

test("gitCwd rethrows a read error other than ENOENT", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "run.json"));
    const error = await gitCwd(dir).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(RelayError);
  });
});

test("gitCwd reports schema errors with and without a field path", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "run.json"), "5\n");
    await expect(gitCwd(dir)).rejects.toMatchObject({ fieldPath: "run.json" });
    await writeFile(join(dir, "run.json"), JSON.stringify(runJson({ id: 5 })));
    const error = await gitCwd(dir).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RelayError);
    expect((error as RelayError).fieldPath).toMatch(/^run\.json:/);
  });
});

test("runGitCwd rethrows a stat error other than ENOENT", async () => {
  vi.mocked(fsp.stat).mockRejectedValueOnce(coded("EACCES"));
  const run = runJson({ worktree: { path: "/x", branch: "main" } });
  await expect(runGitCwd("/r", run as never)).rejects.toMatchObject({ code: "EACCES" });
});

test("listWorktrees parses a bare repository entry", async () => {
  await withTempDir(async (dir) => {
    await execFileAsync("git", ["init", "--bare"], { cwd: dir });
    expect(await listWorktrees(dir)).toEqual([]);
  });
});

test("validateRunWorktree rethrows a realpath error other than ENOENT", async () => {
  vi.mocked(fsp.realpath).mockRejectedValueOnce(coded("EACCES"));
  await expect(validateRunWorktree("/r", { path: "/x", branch: "b" })).rejects.toMatchObject({
    code: "EACCES",
  });
});

test("validateRunWorktree names a missing branch as none", async () => {
  await withTempDir(async (dir) => {
    const runDir = join(dir, ".agent-relay", runName);
    const path = join(dir, "wt");
    await mkdir(runDir, { recursive: true });
    await mkdir(path);
    hooks.git = (args) =>
      args[0] === "worktree" && args[1] === "list"
        ? Promise.resolve({
          stdout: `stray\nworktree ${join(dir, "gone")}\nHEAD abc\n\nworktree ${path}\nHEAD abc\n`,
          stderr: "",
        })
        : undefined;
    await expect(validateRunWorktree(runDir, { path, branch: runName })).rejects.toThrow(
      `worktree branch is none, expected ${runName}`,
    );
  });
});

test("linkRelay uses a junction on win32", async () => {
  await withTempDir(async (dir) => {
    const relayDir = join(dir, "relay");
    const worktree = join(dir, "wt");
    await mkdir(relayDir);
    await mkdir(worktree);
    await writeFile(join(relayDir, "marker"), "x");
    await linkRelay(worktree, relayDir, "win32");
    expect(await readFile(join(worktree, ".agent-relay", "marker"), "utf8")).toBe("x");
  });
});

test("excludeRelay creates a missing exclude file and appends a newline", async () => {
  await withTempGitRepo(async (dir) => {
    const exclude = join(dir, ".git", "info", "exclude");
    await rm(exclude, { force: true });
    await excludeRelay(dir);
    expect(await readFile(exclude, "utf8")).toBe(".agent-relay\n");
    await writeFile(exclude, "foo");
    await excludeRelay(dir);
    expect(await readFile(exclude, "utf8")).toBe("foo\n.agent-relay\n");
  });
});

test("excludeRelay rethrows a read error other than ENOENT", async () => {
  await withTempGitRepo(async (dir) => {
    const exclude = join(dir, ".git", "info", "exclude");
    await rm(exclude, { force: true });
    await mkdir(exclude, { recursive: true });
    const error = await excludeRelay(dir).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
  });
});

test("rollbackWorktree removes a plain folder with and without a relay entry", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    await withTempDir(async (outside) => {
      const plain = join(outside, "plain");
      await mkdir(plain);
      await rollbackWorktree(dir, plain, "no-such-branch");
      expect(await exists(plain)).toBe(false);

      const withDir = join(outside, "with-dir");
      await mkdir(join(withDir, ".agent-relay"), { recursive: true });
      await rollbackWorktree(dir, withDir, "no-such-branch");
      expect(await exists(withDir)).toBe(false);
    });
  });
});

test("addWorktree cleans up after git worktree add fails", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const commit = await head(dir);
    await withTempDir(async (outside) => {
      const relayDir = join(dir, ".agent-relay");
      await mkdir(relayDir, { recursive: true });
      const settings = { dir: outside, branch: "main" };

      // Git left a branch and a folder behind.
      hooks.git = (args, cwd) => {
        if (args[0] !== "worktree" || args[1] !== "add") return undefined;
        return (async () => {
          await execFileAsync("git", ["branch", "half", commit], { cwd });
          await mkdir(join(outside, "half"), { recursive: true });
          throw Object.assign(new Error("failed"), { stderr: " boom \n" });
        })();
      };
      await expect(addWorktree(settings, { relayDir, name: "half", head: commit })).rejects
        .toThrow("git worktree add failed: boom");
      hooks.git = null;
      expect(await exists(join(outside, "half"))).toBe(false);
      await expect(
        execFileAsync("git", ["rev-parse", "--verify", "--quiet", "refs/heads/half"], { cwd: dir }),
      ).rejects.toBeDefined();

      // Git left nothing behind and wrote no stderr.
      hooks.git = (args) =>
        args[0] === "worktree" && args[1] === "add"
          ? Promise.reject(new Error("failed"))
          : undefined;
      await expect(addWorktree(settings, { relayDir, name: "none", head: commit })).rejects
        .toThrow("git worktree add failed: unknown error");
    });
  });
});

test("addWorktree rethrows an lstat error other than ENOENT", async () => {
  await withTempDir(async (dir) => {
    const relayDir = join(dir, ".agent-relay");
    await mkdir(relayDir);
    vi.mocked(fsp.lstat).mockRejectedValueOnce(coded("EACCES"));
    await expect(
      addWorktree({ dir: join(dir, "wt"), branch: "main" }, { relayDir, name: "x", head: "h" }),
    ).rejects.toMatchObject({ code: "EACCES" });
  });
});

test("keepReason reports merge check failures and dirty worktrees", async () => {
  await withRunWorktree(async ({ dir, path, branch }) => {
    const record = { path, branch };
    expect(await keepReason(dir, "no-such-ref", record)).toMatch(/^merge check failed: /);
    hooks.git = (args) => args[0] === "merge-base" ? Promise.reject(new Error("plain")) : undefined;
    expect(await keepReason(dir, runName, record)).toBe("merge check failed: unknown error");
    hooks.git = null;
    expect(await keepReason(dir, runName, record)).toBeNull();
    await writeFile(join(path, "dirty.txt"), "x");
    expect(await keepReason(dir, runName, record)).toBe("worktree has changes");
    await rm(join(path, "dirty.txt"));
  });
});

test("removeMergedWorktree reports unlink failures", async () => {
  await withRunWorktree(async ({ dir, path, branch }) => {
    const run = { name: runName, worktree: { path, branch } };
    vi.mocked(fsp.unlink).mockRejectedValueOnce(new Error("denied"));
    expect(await removeMergedWorktree(dir, run)).toEqual({
      removed: false,
      reason: "unlink .agent-relay failed: denied",
    });
    vi.mocked(fsp.unlink).mockRejectedValueOnce("odd");
    expect(await removeMergedWorktree(dir, run)).toEqual({
      removed: false,
      reason: "unlink .agent-relay failed: odd",
    });
  });
});

test("removeMergedWorktree restores the link when git worktree remove fails", async () => {
  await withRunWorktree(async ({ dir, path, branch }) => {
    const run = { name: runName, worktree: { path, branch } };
    hooks.git = (args) =>
      args[0] === "worktree" && args[1] === "remove"
        ? Promise.reject(new Error("busy"))
        : undefined;
    const link = join(path, ".agent-relay");
    expect(await removeMergedWorktree(dir, run)).toEqual({
      removed: false,
      reason: "git worktree remove failed: unknown error",
    });
    expect(await exists(link)).toBe(true);

    // Without a link there is nothing to restore.
    await fsp.unlink(link);
    expect(await removeMergedWorktree(dir, run)).toMatchObject({ removed: false });
    expect(await exists(link)).toBe(false);
  });
});

test("worktreeCleanupText falls back to unknown", () => {
  expect(worktreeCleanupText({ schema: 1, path: "/p", worktree: { removed: false } })).toBe(
    "worktree: kept (unknown)\n",
  );
});

test("cleanupWorktree removes a merged worktree and records the agent actor", async () => {
  vi.stubEnv("CODEX_THREAD_ID", "thread-1");
  await withRunWorktree(async ({ runDir, path, branch }) => {
    await seedRun(runDir, { worktree: { path, branch } });
    const result = await cleanupWorktree(runDir);
    expect(result.worktree).toEqual({ removed: true });
    expect(await exists(path)).toBe(false);
    const cleaned = (await events(runDir)).find((event) => event.action === "cleaned");
    expect(cleaned?.actor).toBe("agent-env");
  });
});

test("cleanupWorktree keeps a worktree that fails validation", async () => {
  await withTempDir(async (dir) => {
    const runDir = join(dir, ".agent-relay", runName);
    const path = join(dir, "wt");
    await mkdir(path);
    await seedRun(runDir, { worktree: { path, branch: "main" } });
    const result = await cleanupWorktree(runDir);
    expect(result.worktree.removed).toBe(false);
    expect(result.worktree.reason?.length).toBeGreaterThan(0);

    vi.mocked(fsp.realpath).mockImplementation((p, o) =>
      p === path ? Promise.reject("odd") : realFs.realpath(p, o as never)
    );
    expect((await cleanupWorktree(runDir)).worktree).toEqual({ removed: false, reason: "odd" });
  });
});

test("cleanupWorktree refuses a run without a worktree or not closed", async () => {
  await withTempDir(async (dir) => {
    const runDir = join(dir, runName);
    await seedRun(runDir, {});
    await expect(cleanupWorktree(runDir)).rejects.toThrow("run has no worktree");
    await seedRun(runDir, {
      worktree: { path: join(dir, "wt"), branch: "main" },
      state: { lifecycle: "planned", stage: "plan", approved: false, tasks: [] },
    }, []);
    await expect(cleanupWorktree(runDir)).rejects.toThrow("worktree cleanup refused");
  });
});

// A closed run whose worktree folder is already gone needs no git.
async function withMissingRun(fn: (runDir: string) => Promise<void>): Promise<void> {
  await withTempDir(async (dir) => {
    const runDir = join(dir, runName);
    await seedRun(runDir, { worktree: { path: join(dir, "missing-wt"), branch: "main" } });
    await fn(runDir);
  });
}

test("cleanupWorktree skips a second cleaned event", async () => {
  await withTempDir(async (dir) => {
    const runDir = join(dir, runName);
    await seedRun(runDir, { worktree: { path: join(dir, "gone"), branch: "main" } }, [
      "closed",
      "cleaned",
    ]);
    expect((await cleanupWorktree(runDir)).worktree).toEqual({ removed: true });
    expect((await events(runDir)).filter((event) => event.action === "cleaned")).toHaveLength(1);
  });
});

test("cleanup lock writes unknown when the host name is empty", async () => {
  await withMissingRun(async (runDir) => {
    vi.mocked(os.hostname).mockReturnValueOnce("");
    const writes: string[] = [];
    vi.mocked(fsp.open).mockImplementationOnce(async (path, flags) => {
      const handle = await realFs.open(path, flags);
      const write = handle.writeFile.bind(handle);
      handle.writeFile = (data: never) => {
        writes.push(String(data));
        return write(data);
      };
      return handle;
    });
    expect((await cleanupWorktree(runDir)).worktree.removed).toBe(true);
    expect(JSON.parse(writes[0]!)).toMatchObject({ host: "unknown" });
  });
});

test("cleanup lock removes the lock file when the write fails", async () => {
  await withMissingRun(async (runDir) => {
    vi.mocked(fsp.open).mockImplementationOnce(async (path, flags) => {
      const handle = await realFs.open(path, flags);
      handle.writeFile = () => Promise.reject(new Error("disk full"));
      return handle;
    });
    await expect(cleanupWorktree(runDir)).rejects.toThrow("disk full");
    expect(await exists(join(runDir, "locks", "run.lock"))).toBe(false);
  });
});

test("cleanup lock rethrows open errors it cannot wait on", async () => {
  await withMissingRun(async (runDir) => {
    vi.mocked(fsp.open).mockRejectedValueOnce("odd");
    await expect(cleanupWorktree(runDir)).rejects.toBe("odd");
    vi.mocked(fsp.open).mockRejectedValueOnce(coded(5));
    await expect(cleanupWorktree(runDir)).rejects.toThrow("denied");
    vi.mocked(fsp.open).mockRejectedValueOnce(coded("EACCES"));
    await expect(cleanupWorktree(runDir)).rejects.toMatchObject({ code: "EACCES" });
  });
});

test("cleanup lock retries after EPERM and a vanished lock", async () => {
  await withMissingRun(async (runDir) => {
    vi.mocked(fsp.open).mockRejectedValueOnce(coded("EPERM"));
    expect((await cleanupWorktree(runDir)).worktree.removed).toBe(true);
  });
});

test("cleanup lock rethrows stale check errors other than ENOENT", async () => {
  await withMissingRun(async (runDir) => {
    for (const failure of ["odd", new Error("no code"), coded(5)]) {
      vi.mocked(fsp.open).mockRejectedValueOnce(coded("EEXIST"));
      vi.mocked(fsp.stat).mockRejectedValueOnce(failure);
      const error = await cleanupWorktree(runDir).catch((caught: unknown) => caught);
      expect(error).toBe(failure);
    }
  });
});

test("cleanup lock waits for a fresh lock to go away", async () => {
  await withMissingRun(async (runDir) => {
    const lockPath = join(runDir, "locks", "run.lock");
    await mkdir(join(runDir, "locks"), { recursive: true });
    await writeFile(lockPath, "{}\n");
    const timer = setTimeout(() => void rm(lockPath, { force: true }), 150);
    try {
      expect((await cleanupWorktree(runDir)).worktree.removed).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });
});

test("cleanup lock times out", async () => {
  await withMissingRun(async (runDir) => {
    vi.mocked(fsp.open).mockRejectedValueOnce(coded("EEXIST"));
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(20_000);
    await expect(cleanupWorktree(runDir)).rejects.toMatchObject({
      code: "lock",
      message: "run lock timed out",
    });
    expect(basename(runDir)).toBe(runName);
  });
});

test("keepReason reports unmerged branches and status failures", async () => {
  await withRunWorktree(async ({ dir, path, branch }) => {
    expect(await keepReason(dir, runName, { path: join(dir, "nope"), branch })).toBe(
      "worktree status failed",
    );
    await gitCommit(path, "run work");
    expect(await keepReason(dir, runName, { path, branch })).toBe(
      `branch not merged into ${branch}`,
    );
  });
});

test("cleanupWorktree keeps a dirty worktree", async () => {
  await withRunWorktree(async ({ runDir, path, branch }) => {
    await seedRun(runDir, { worktree: { path, branch } });
    await writeFile(join(path, "dirty.txt"), "x");
    expect((await cleanupWorktree(runDir)).worktree).toEqual({
      removed: false,
      reason: "worktree has changes",
    });
  });
});

test("addWorktree defaults the folder to a sibling of the repository", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const relayDir = join(dir, ".agent-relay");
    await mkdir(relayDir, { recursive: true });
    const root = await fsp.realpath(dir);
    const sibling = `${root}_work-tree`;
    try {
      const record = await addWorktree({ branch: "main" }, {
        relayDir,
        name: runName,
        head: await head(dir),
      });
      expect(record.path).toBe(join(sibling, runName));
      await rollbackWorktree(root, record.path, runName);
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });
});

test("gitCwd covers the run folder and a gone worktree", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "run.json"), JSON.stringify(runJson({})));
    expect(await gitCwd(dir)).toBe(dir);
    const gone = runJson({ worktree: { path: join(dir, "gone"), branch: "main" } });
    await writeFile(join(dir, "run.json"), JSON.stringify(gone));
    await expect(gitCwd(dir)).rejects.toMatchObject({ code: "not_found" });
  });
});

test("small helpers cover their plain paths", async () => {
  expect(worktreeCleanupText({ schema: 1, path: "/p", worktree: { removed: true } })).toBe(
    "worktree: removed\n",
  );
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".agent-relay"));
    await expect(linkRelay(dir, dir)).rejects.toThrow("already exists");
    await expect(validateRunWorktree(dir, { path: join(dir, "gone"), branch: "b" })).rejects
      .toThrow("worktree not found");
  });
});

test("addWorktree and validateRunWorktree refuse conflicts", async () => {
  await withRunWorktree(async ({ dir, runDir, path }) => {
    await excludeRelay(dir);
    const relayDir = join(dir, ".agent-relay");
    const commit = await head(dir);
    await expect(
      addWorktree({ dir: dirname(path), branch: "main" }, {
        relayDir,
        name: runName,
        head: commit,
      }),
    ).rejects.toThrow("worktree path already exists");
    await expect(
      addWorktree({ dir: join(dirname(path), "other"), branch: "main" }, {
        relayDir,
        name: runName,
        head: commit,
      }),
    ).rejects.toThrow("worktree branch already exists");
    await expect(validateRunWorktree(runDir, { path: dirname(path), branch: runName })).rejects
      .toThrow("not registered");
    await execFileAsync("git", ["checkout", "--detach"], { cwd: path });
    await expect(validateRunWorktree(runDir, { path, branch: runName })).rejects.toThrow(
      "detached",
    );
  });
});

test("worktreeSettings leaves dir out when the policy has none", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 20,
        worktree: { enabled: true },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir, "policy");
    const settings = await worktreeSettings(dir, await head(dir));
    expect(settings).toEqual({ branch: await baseBranch(dir) });
  });
});
