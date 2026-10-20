import type { FileHandle } from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { acquireLock, createStealGuard, readOwner, stealLock } from "../src/core/lock.js";
import { assertWritable, withRunLock } from "../src/core/mutate.js";
import type { RunState } from "../src/core/reduce.js";
import { withTempDir } from "./helper.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), stat: vi.fn(actual.stat) };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, hostname: vi.fn(actual.hostname) };
});

const realOpen = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"))
  .open;

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.open).mockImplementation(realOpen);
  vi.mocked(fs.stat).mockReset();
  vi.mocked(os.hostname).mockReset();
  vi.mocked(os.hostname).mockReturnValue("test-host");
});

function codeError(code: unknown): Error {
  return Object.assign(new Error(`fail ${String(code)}`), { code });
}

function captureWrites(): string[] {
  const writes: string[] = [];
  vi.mocked(fs.open).mockImplementationOnce(async (...args: Parameters<typeof realOpen>) => {
    const handle = await realOpen(...args);
    const write = handle.writeFile.bind(handle);
    handle.writeFile = (async (data: string, options?: unknown) => {
      writes.push(data);
      return write(data, options as BufferEncoding);
    }) as FileHandle["writeFile"];
    return handle;
  });
  return writes;
}

const noop = () => Promise.resolve();

test("withRunLock writes host unknown when hostname is empty", async () => {
  await withTempDir(async (dir) => {
    vi.mocked(os.hostname).mockReturnValue("");
    const writes = captureWrites();
    await expect(withRunLock(dir, noop)).rejects.not.toMatchObject({ code: "lock" });
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({ host: "unknown" });
  });
});

test("withRunLock rethrows a non-Error and a non-string code from open", async () => {
  await withTempDir(async (dir) => {
    vi.mocked(fs.open).mockRejectedValueOnce("boom");
    await expect(withRunLock(dir, noop)).rejects.toBe("boom");
    const numeric = codeError(13);
    vi.mocked(fs.open).mockRejectedValueOnce(numeric);
    await expect(withRunLock(dir, noop)).rejects.toBe(numeric);
    const denied = codeError("EACCES");
    vi.mocked(fs.open).mockRejectedValueOnce(denied);
    await expect(withRunLock(dir, noop)).rejects.toBe(denied);
  });
});

test("withRunLock removes the lock when the write fails", async () => {
  await withTempDir(async (dir) => {
    const failure = new Error("disk full");
    vi.mocked(fs.open).mockImplementationOnce(async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args);
      handle.writeFile = (() => Promise.reject(failure)) as FileHandle["writeFile"];
      return handle;
    });
    await expect(withRunLock(dir, noop)).rejects.toBe(failure);
    await expect(readFile(join(dir, "locks", "run.lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

test("withRunLock retries after EPERM and a vanished lock", async () => {
  await withTempDir(async (dir) => {
    vi.mocked(fs.open).mockRejectedValueOnce(codeError("EPERM"));
    vi.mocked(fs.stat).mockRejectedValueOnce(codeError("ENOENT"));
    const writes = captureWrites();
    await expect(withRunLock(dir, noop)).rejects.not.toMatchObject({ code: "lock" });
    expect(writes).toHaveLength(1);
  });
});

test("withRunLock rethrows a stat failure other than ENOENT", async () => {
  await withTempDir(async (dir) => {
    const failure = codeError("EACCES");
    vi.mocked(fs.open).mockRejectedValueOnce(codeError("EEXIST"));
    vi.mocked(fs.stat).mockRejectedValueOnce(failure);
    await expect(withRunLock(dir, noop)).rejects.toBe(failure);
  });
});

test("readOwner rethrows a read failure other than ENOENT", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "locks", "T1.lock"), { recursive: true });
    await expect(readOwner(dir, "T1")).rejects.not.toMatchObject({ code: "not_found" });
  });
});

test("acquireLock writes host unknown and rethrows non-EEXIST errors", async () => {
  await withTempDir(async (dir) => {
    vi.mocked(os.hostname).mockReturnValue("");
    const lock = await acquireLock(dir, "T1", "session-a");
    expect(lock.host).toBe("unknown");
    expect((await readOwner(dir, "T1")).host).toBe("unknown");
    vi.mocked(fs.open).mockRejectedValueOnce("boom");
    await expect(acquireLock(dir, "T2", "session-a")).rejects.toBe("boom");
    const denied = codeError("EACCES");
    vi.mocked(fs.open).mockRejectedValueOnce(denied);
    await expect(acquireLock(dir, "T2", "session-a")).rejects.toBe(denied);
  });
});

test("acquireLock reports an unknown owner when the lock is unreadable", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "locks"), { recursive: true });
    await writeFile(join(dir, "locks", "T1.lock"), "not json\n");
    await expect(acquireLock(dir, "T1", "session-b")).rejects.toMatchObject({
      code: "lock",
      message: "lock held by unknown",
    });
  });
});

test("createStealGuard rethrows a non-Error from open", async () => {
  await withTempDir(async (dir) => {
    vi.mocked(fs.open).mockRejectedValueOnce("boom");
    await expect(createStealGuard(dir, "T1", "session-a")).rejects.toBe("boom");
    const denied = codeError("EACCES");
    vi.mocked(fs.open).mockRejectedValueOnce(denied);
    await expect(createStealGuard(dir, "T1", "session-a")).rejects.toBe(denied);
    await createStealGuard(dir, "T1", "session-a");
    await expect(createStealGuard(dir, "T1", "session-b")).rejects.toMatchObject({
      code: "lock",
    });
  });
});

test("stealLock refuses an empty session", async () => {
  await withTempDir(async (dir) => {
    await expect(stealLock(dir, "T1", "", 0)).rejects.toMatchObject({ code: "usage" });
  });
});

test("assertWritable refuses closed and abandoned runs", () => {
  const state = (lifecycle: string) => ({ lifecycle }) as unknown as RunState;
  expect(() => assertWritable(state("closed"))).toThrow("run is closed");
  expect(() => assertWritable(state("abandoned"))).toThrow("run is abandoned");
  expect(() => assertWritable(state("reviewing"))).not.toThrow();
});

test("withRunLock times out while a fresh lock is held", async () => {
  await withTempDir(async (dir) => {
    vi.spyOn(Date, "now").mockReturnValueOnce(0);
    vi.mocked(fs.open).mockRejectedValueOnce(codeError("EEXIST"));
    await expect(withRunLock(dir, noop)).rejects.toMatchObject({
      code: "lock",
      message: "run lock timed out",
    });
  });
});

test("withRunLock waits on a fresh lock and clears a stale one", async () => {
  await withTempDir(async (dir) => {
    const fresh = { mtimeMs: Date.now() } as Awaited<ReturnType<typeof fs.stat>>;
    const stale = { mtimeMs: 0 } as Awaited<ReturnType<typeof fs.stat>>;
    vi.mocked(fs.open)
      .mockRejectedValueOnce(codeError("EEXIST"))
      .mockRejectedValueOnce(codeError("EEXIST"));
    vi.mocked(fs.stat).mockResolvedValueOnce(fresh).mockResolvedValueOnce(stale);
    const writes = captureWrites();
    await expect(withRunLock(dir, noop)).rejects.not.toMatchObject({ code: "lock" });
    expect(writes).toHaveLength(1);
    expect(fs.stat).toHaveBeenCalledTimes(2);
  });
});

test("lock helpers reject bad task names, empty sessions, and bad lock files", async () => {
  await withTempDir(async (dir) => {
    await expect(readOwner(dir, "bad task")).rejects.toMatchObject({ code: "validation" });
    await expect(acquireLock(dir, "T1", "")).rejects.toMatchObject({ code: "usage" });
    await mkdir(join(dir, "locks"), { recursive: true });
    await writeFile(join(dir, "locks", "T1.lock"), `${JSON.stringify({ schema: 1 })}\n`);
    await expect(readOwner(dir, "T1")).rejects.toMatchObject({ code: "validation" });
  });
});

test("stealLock refuses a fresh lock and takes a stale one", async () => {
  await withTempDir(async (dir) => {
    await acquireLock(dir, "T1", "session-a");
    await expect(stealLock(dir, "T1", "session-b", 60_000)).rejects.toMatchObject({
      code: "lock",
      message: "lock held by session-a",
    });
    const lock = await stealLock(dir, "T1", "session-b", 0);
    expect(lock.session).toBe("session-b");
    expect((await readOwner(dir, "T1")).session).toBe("session-b");
  });
});
