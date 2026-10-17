import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { nextVersion } from "../scripts/maint/next-version.ts";
import { RelayError } from "../src/core/error.js";
import { gitCommit, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);
const script = new URL("../scripts/maint/next-version.ts", import.meta.url);

const october = new Date("2026-10-17T12:00:00.000Z");

test("first release uses month 0", () => {
  expect(nextVersion({ tags: [], now: october, major: false })).toEqual({
    version: "0.10.0",
    tag: "v0.10.0",
  });
});

test("same month increments Z", () => {
  expect(nextVersion({ tags: ["v0.10.0"], now: october, major: false }).version).toBe("0.10.1");
});

test("a new month resets Z", () => {
  const november = new Date("2026-11-02T00:00:00.000Z");
  expect(nextVersion({ tags: ["v0.10.4"], now: november, major: false }).version).toBe("0.11.0");
});

test("major raises X and resets Z", () => {
  expect(nextVersion({ tags: ["v0.10.4"], now: october, major: true }).version).toBe("1.10.0");
});

test("January after December without major is refused", () => {
  const january = new Date("2027-01-15T00:00:00.000Z");
  expect(() => nextVersion({ tags: ["v0.12.4"], now: january, major: false })).toThrow(
    /major: true/,
  );
});

test("Z at 99 is refused", () => {
  expect(() => nextVersion({ tags: ["v0.10.99"], now: october, major: false })).toThrow(/99/);
});

test("a bad tag is refused and named", () => {
  expect(() => nextVersion({ tags: ["v26.09.28"], now: october, major: false })).toThrow(
    /v26\.09\.28/,
  );
  let error: unknown;
  try {
    nextVersion({ tags: ["v1.0.1"], now: october, major: false });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(RelayError);
  expect((error as RelayError).code).toBe("validation");
  expect((error as RelayError).message).toContain("v1.0.1");
});

test("a time near midnight uses Asia/Ho_Chi_Minh", () => {
  const boundary = new Date("2026-10-31T17:30:00.000Z");
  expect(nextVersion({ tags: ["v0.10.4"], now: boundary, major: false }).version).toBe("0.11.0");
});

test("the command prints the version", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    await execFileAsync("git", ["tag", "v0.10.0"], { cwd: dir });
    const result = await execFileAsync(process.execPath, [
      "--experimental-strip-types",
      fileURLToPath(script),
      "--now",
      "2026-10-17T12:00:00.000Z",
    ], { cwd: dir });
    expect(result.stdout).toBe("0.10.1\n");
  });
});
