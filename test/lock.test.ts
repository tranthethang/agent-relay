import { expect, test } from "vitest";
import { RelayError } from "../src/core/error.js";
import { acquireLock, isStale, readOwner, releaseLock } from "../src/core/lock.js";
import { withTempDir } from "./helper.js";

test("acquire uses wx and release requires the owner", async () => {
  await withTempDir(async (dir) => {
    const lock = await acquireLock(dir, "T1", "session-a");
    expect(lock.schema).toBe(1);
    expect(lock.session).toBe("session-a");
    expect(lock.pid).toBe(process.pid);
    const owner = await readOwner(dir, "T1");
    expect(owner.session).toBe("session-a");
    await expect(acquireLock(dir, "T1", "session-b")).rejects.toMatchObject({
      code: "lock",
      exitCode: 5,
    });
    await expect(releaseLock(dir, "T1", "session-b")).rejects.toMatchObject({
      code: "lock",
      exitCode: 5,
    });
    await releaseLock(dir, "T1", "session-a");
    await expect(readOwner(dir, "T1")).rejects.toMatchObject({ code: "not_found", exitCode: 3 });
  });
});

test("isStale follows the ttl argument", async () => {
  await withTempDir(async (dir) => {
    const lock = await acquireLock(dir, "T2", "session-a");
    const ts = Date.parse(lock.ts);
    expect(isStale(lock, 1000, ts + 999)).toBe(false);
    expect(isStale(lock, 1000, ts + 1000)).toBe(true);
    expect(() => isStale(lock, -1, ts)).toThrow(RelayError);
  });
});
