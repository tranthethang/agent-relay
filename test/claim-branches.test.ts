import * as fsp from "node:fs/promises";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { rebuildRun } from "../src/core/cache.js";
import {
  assertClaimOwner,
  claimTask,
  ensureImplement,
  exists,
  listTasks,
  readSchema,
  releaseClaimLock,
  releaseText,
  stealTask,
} from "../src/core/claim.js";
import { findRelayDir } from "../src/core/discover.js";
import { RelayError } from "../src/core/error.js";
import { readJson } from "../src/core/files.js";
import { readOwner, releaseLock } from "../src/core/lock.js";
import { withRunLock } from "../src/core/mutate.js";
import { type RunState } from "../src/core/reduce.js";
import {
  createBrainstorm,
  createRun,
  resolveBrainstorm,
  runNewText,
} from "../src/core/scaffold.js";
import { gitCommit, withTempGitRepo } from "./helper.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, mkdir: vi.fn(real.mkdir), stat: vi.fn(real.stat) };
});
vi.mock("../src/core/discover.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/discover.js")>();
  return { ...real, findRelayDir: vi.fn(real.findRelayDir) };
});
vi.mock("../src/core/files.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/files.js")>();
  return { ...real, readJson: vi.fn(real.readJson) };
});
vi.mock("../src/core/lock.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/lock.js")>();
  return {
    ...real,
    readOwner: vi.fn(real.readOwner),
    releaseLock: vi.fn(real.releaseLock),
  };
});
vi.mock("../src/core/mutate.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/mutate.js")>();
  return { ...real, withRunLock: vi.fn(real.withRunLock) };
});
vi.mock("../src/core/cache.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/cache.js")>();
  return { ...real, rebuildRun: vi.fn(real.rebuildRun) };
});

const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "atry-claim-")));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function state(tasks: RunState["tasks"]): RunState {
  return { lifecycle: "implementing", stage: "implement", approved: true, tasks } as RunState;
}

function fakeLock(runState: RunState): void {
  vi.mocked(withRunLock).mockImplementationOnce(async (_dir, fn) =>
    fn({ run: { state: runState }, events: [] } as unknown as Parameters<typeof fn>[0])
  );
}

async function writeIndex(runDir: string, tasks: { id: string; deps: string[] }[]) {
  await mkdir(join(runDir, "10-plan"), { recursive: true });
  const index = {
    schema: 1,
    tasks: tasks.map((task) => ({
      ...task,
      title: task.id,
      files: [`src/${task.id}.ts`],
      path: `10-plan/${task.id}.md`,
    })),
  };
  await writeFile(join(runDir, "10-plan", "index.json"), JSON.stringify(index));
}

afterEach(() => {
  vi.mocked(fsp.mkdir).mockImplementation(realFs.mkdir);
});

describe("scaffold branches", () => {
  test("runNewText prints the worktree line", () => {
    const base = {
      schema: 1 as const,
      path: "/r",
      name: "n",
      id: "1",
      ymd: "20260101",
      slug: "s",
      title: "t",
      base: "b",
    };
    expect(runNewText(base)).toBe("/r\n");
    expect(runNewText({ ...base, worktree: { path: "/w" } as never })).toBe("/r\nworktree: /w\n");
  });

  test("createBrainstorm refuses a name with a non 8 digit date", async () => {
    await withDir(async (dir) => {
      vi.mocked(findRelayDir).mockResolvedValueOnce(dir);
      await expect(createBrainstorm({ cwd: dir, slug: "x", nowMs: 1e15 })).rejects.toMatchObject({
        code: "validation",
        message: "invalid brainstorm name",
      });
    });
  });

  test("createBrainstorm rethrows a mkdir error other than EEXIST", async () => {
    await withDir(async (dir) => {
      vi.mocked(findRelayDir).mockResolvedValueOnce(dir);
      vi.mocked(fsp.mkdir)
        .mockImplementationOnce(realFs.mkdir)
        .mockRejectedValueOnce(codeError("EACCES"));
      await expect(createBrainstorm({ cwd: dir, slug: "x", nowMs: 0 })).rejects.toMatchObject({
        code: "EACCES",
      });
    });
  });

  test("createBrainstorm rethrows a relay lookup error other than not_found", async () => {
    vi.mocked(findRelayDir).mockRejectedValueOnce(new Error("boom"));
    await expect(createBrainstorm({ cwd: "/x", slug: "x" })).rejects.toThrow("boom");
    vi.mocked(findRelayDir).mockRejectedValueOnce(new RelayError("gate", "bad", "x"));
    await expect(createBrainstorm({ cwd: "/x", slug: "x" })).rejects.toThrow("bad");
  });

  test("createRun retries on EEXIST and rethrows other mkdir errors", async () => {
    await withTempGitRepo(async (dir) => {
      await gitCommit(dir);
      await mkdir(join(dir, ".agent-relay"));
      const failures: unknown[] = [];
      vi.mocked(fsp.mkdir).mockImplementation(async (path, options) => {
        if (options === undefined && /-\d+-cov$/.test(String(path)) && failures.length > 0) {
          throw failures.shift();
        }
        return realFs.mkdir(path, options);
      });
      const nowMs = Date.UTC(2026, 0, 1);
      const id = String(Math.floor(nowMs / 1000));
      failures.push(codeError("EEXIST"));
      const made = await createRun({ cwd: dir, slug: "cov", title: "t", nowMs });
      expect(made.id).toBe(String(Number(id) + 1));
      for (const failure of ["plain", new Error("nocode"), codeError("EACCES")]) {
        failures.push(failure);
        await expect(createRun({ cwd: dir, slug: "cov", title: "t", nowMs })).rejects.toBe(
          failure,
        );
      }
    });
  });

  test("resolveBrainstorm rethrows a stat error other than ENOENT", async () => {
    await withDir(async (dir) => {
      const error = codeError("EACCES");
      vi.mocked(fsp.stat).mockRejectedValueOnce(error);
      await expect(resolveBrainstorm(dir, "20260101-x")).rejects.toBe(error);
    });
  });
});

describe("claim branches", () => {
  test("releaseText prints a reason only when set", () => {
    const base = {
      schema: 1 as const,
      path: "/r",
      task: "T1",
      session: "s",
      action: "released" as const,
      forced: true,
    };
    expect(releaseText(base)).not.toContain("reason");
    expect(releaseText({ ...base, reason: "why" })).toContain("reason: why\n");
  });

  test("assertClaimOwner and releaseClaimLock rethrow unexpected errors", async () => {
    vi.mocked(readOwner).mockRejectedValueOnce(new Error("read"));
    await expect(assertClaimOwner("/r", "T1", "s")).rejects.toThrow("read");
    vi.mocked(readOwner).mockRejectedValueOnce(new RelayError("lock", "held", "x"));
    await expect(assertClaimOwner("/r", "T1", "s")).rejects.toThrow("held");
    vi.mocked(releaseLock).mockRejectedValueOnce(new Error("rel"));
    await expect(releaseClaimLock("/r", "T1", "s")).rejects.toThrow("rel");
    vi.mocked(releaseLock).mockRejectedValueOnce(new RelayError("lock", "other", "x"));
    await expect(releaseClaimLock("/r", "T1", "s")).rejects.toThrow("other");
  });

  test("claim and steal refuse finished tasks and unfinished deps", async () => {
    await withDir(async (dir) => {
      await writeIndex(dir, [
        { id: "T1", deps: [] },
        { id: "T2", deps: [] },
        { id: "T3", deps: ["T1", "T2"] },
      ]);
      const done = state(
        [
          { id: "T1", status: "done" },
          { id: "T2", status: "skipped" },
        ] as RunState["tasks"],
      );
      fakeLock(done);
      await expect(claimTask(dir, "T1", "s")).rejects.toThrow("claim refused: T1 is done");
      fakeLock(done);
      await expect(stealTask(dir, "T2", "s", 1)).rejects.toThrow("steal refused: T2 is skipped");
      const partial = state([{ id: "T1", status: "done" }] as RunState["tasks"]);
      fakeLock(partial);
      await expect(claimTask(dir, "T3", "s")).rejects.toThrow("claim refused: T2 is pending");
    });
  });

  test("listTasks rethrows an unexpected owner error", async () => {
    await withDir(async (dir) => {
      await writeIndex(dir, [{ id: "T1", deps: [] }]);
      vi.mocked(rebuildRun).mockResolvedValueOnce(
        { run: { state: state([]) }, events: [] } as never,
      );
      vi.mocked(readOwner).mockRejectedValueOnce(new Error("owner"));
      await expect(listTasks(dir)).rejects.toThrow("owner");
    });
  });

  test("readSchema maps read and parse failures", async () => {
    await withDir(async (dir) => {
      const schema = z.object({ a: z.number() });
      const file = join(dir, "x.json");
      await expect(readSchema(file, "x.json", schema, "missing")).rejects.toMatchObject({
        code: "not_found",
        message: "missing",
      });
      await writeFile(file, "{");
      await expect(readSchema(file, "x.json", schema, "missing")).rejects.toMatchObject({
        code: "validation",
        message: "invalid JSON",
        fieldPath: "x.json",
      });
      await writeFile(file, "5");
      await expect(readSchema(file, "x.json", schema, "missing")).rejects.toMatchObject({
        code: "validation",
        fieldPath: "x.json",
      });
      await writeFile(file, "{\"a\":\"s\"}");
      await expect(readSchema(file, "x.json", schema, "missing")).rejects.toMatchObject({
        fieldPath: "x.json:a",
      });
      const plain = codeError("EACCES");
      vi.mocked(readJson).mockRejectedValueOnce(plain);
      await expect(readSchema(file, "x.json", schema, "missing")).rejects.toBe(plain);
      const relay = new RelayError("gate", "other", "x");
      vi.mocked(readJson).mockRejectedValueOnce(relay);
      await expect(readSchema(file, "x.json", schema, "missing")).rejects.toBe(relay);
    });
  });

  test("exists rethrows a stat error other than ENOENT", async () => {
    const error = codeError("EACCES");
    vi.mocked(fsp.stat).mockRejectedValueOnce(error);
    await expect(exists("/x")).rejects.toBe(error);
    await withDir(async (dir) => {
      const file = await ensureImplement(dir, "T1", "One");
      expect(await ensureImplement(dir, "T1", "One")).toBe(file);
      expect(await exists(join(dir, "nope"))).toBe(false);
    });
  });
});
