import * as fs from "node:fs/promises";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { acquireRunLock, releaseRunLock, staleLockMs } from "../src/core/runlock.js";
import { withTempDir } from "./helper.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile), stat: vi.fn(actual.stat) };
});

const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fs.readFile).mockReset();
  vi.mocked(fs.readFile).mockImplementation(actualFs.readFile);
  vi.mocked(fs.stat).mockReset();
  vi.mocked(fs.stat).mockImplementation(actualFs.stat);
});

function codeError(code: string): Error {
  return Object.assign(new Error(`fail ${code}`), { code });
}

async function writeStale(path: string, text: string): Promise<void> {
  await writeFile(path, text);
  const old = new Date(Date.now() - staleLockMs - 1_000);
  await utimes(path, old, old);
}

async function exists(path: string): Promise<boolean> {
  try {
    await actualFs.stat(path);
    return true;
  } catch {
    return false;
  }
}

test("acquireRunLock writes an owner token and release removes only that owner", async () => {
  await withTempDir(async (dir) => {
    const lock = await acquireRunLock(dir);
    const body = JSON.parse(await readFile(lock.path, "utf8")) as { token: string };
    expect(body.token).toBe(lock.token);
    expect(lock.token).toMatch(/^[0-9a-f]{32}$/);
    await releaseRunLock({ path: lock.path, token: "other" });
    expect(await exists(lock.path)).toBe(true);
    await releaseRunLock(lock);
    expect(await exists(lock.path)).toBe(false);
    await expect(releaseRunLock(lock)).resolves.toBeUndefined();
  });
});

test("releaseRunLock keeps a lock without a readable token", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "run.lock");
    for (const text of ["lock", "null", "{}", `{"token":7}`]) {
      await writeFile(path, text);
      await releaseRunLock({ path, token: "abc" });
      expect(await exists(path)).toBe(true);
    }
  });
});

test("releaseRunLock rethrows a read failure other than ENOENT", async () => {
  await withTempDir(async (dir) => {
    const failure = codeError("EACCES");
    vi.mocked(fs.readFile).mockRejectedValueOnce(failure);
    await expect(releaseRunLock({ path: join(dir, "run.lock"), token: "abc" })).rejects.toBe(
      failure,
    );
  });
});

test("acquireRunLock breaks a stale lock and removes the break file", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "locks"), { recursive: true });
    const path = join(dir, "locks", "run.lock");
    await writeStale(path, "{}\n");
    const lock = await acquireRunLock(dir);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ token: lock.token });
    expect(await exists(`${path}.break`)).toBe(false);
  });
});

test("acquireRunLock keeps a lock that changed after it looked stale", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "locks"), { recursive: true });
    const path = join(dir, "locks", "run.lock");
    await writeStale(path, "old\n");
    const realRead = actualFs.readFile;
    let reads = 0;
    vi.mocked(fs.readFile).mockImplementation(
      (async (...args: Parameters<typeof realRead>) => {
        reads += 1;
        // The second read is the check under the break lock. Another owner took the lock.
        if (reads === 2) await writeFile(path, "new\n");
        return realRead(...args);
      }) as typeof fs.readFile,
    );
    const now = Date.now();
    let calls = 0;
    // Deadline, deadline check, and stale check use the real time. The next check times out.
    vi.spyOn(Date, "now").mockImplementation(() => {
      calls += 1;
      return calls <= 3 ? now : now + 20_000;
    });
    await expect(acquireRunLock(dir)).rejects.toMatchObject({
      code: "lock",
      message: "run lock timed out",
    });
    expect(await readFile(path, "utf8")).toBe("new\n");
  });
});

test("acquireRunLock waits while another process holds a fresh break file", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "locks"), { recursive: true });
    const path = join(dir, "locks", "run.lock");
    await writeStale(path, "{}\n");
    await writeFile(`${path}.break`, "{}\n");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValueOnce(now).mockReturnValueOnce(now)
      .mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValue(now + 20_000);
    await expect(acquireRunLock(dir)).rejects.toMatchObject({ message: "run lock timed out" });
    expect(await exists(path)).toBe(true);
    expect(await exists(`${path}.break`)).toBe(true);
  });
});

test("acquireRunLock removes a stale break file and then breaks the lock", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "locks"), { recursive: true });
    const path = join(dir, "locks", "run.lock");
    await writeStale(path, "{}\n");
    await writeStale(`${path}.break`, "{}\n");
    const lock = await acquireRunLock(dir);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ token: lock.token });
    expect(await exists(`${path}.break`)).toBe(false);
  });
});

test("acquireRunLock retries when the break file vanishes or the lock goes away", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "locks"), { recursive: true });
    const path = join(dir, "locks", "run.lock");
    await writeStale(path, "{}\n");
    await writeFile(`${path}.break`, "{}\n");
    vi.mocked(fs.stat).mockImplementation(
      (async (target: Parameters<typeof actualFs.stat>[0]) => {
        if (String(target).endsWith(".break")) {
          await actualFs.rm(String(target), { force: true });
          throw codeError("ENOENT");
        }
        return actualFs.stat(target);
      }) as typeof fs.stat,
    );
    const lock = await acquireRunLock(dir);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ token: lock.token });
  });
});

test("acquireRunLock rethrows a lock read failure other than ENOENT", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "locks"), { recursive: true });
    await writeFile(join(dir, "locks", "run.lock"), "{}\n");
    const failure = codeError("EACCES");
    vi.mocked(fs.readFile).mockRejectedValueOnce(failure);
    await expect(acquireRunLock(dir)).rejects.toBe(failure);
  });
});
