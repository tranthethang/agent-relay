import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import {
  assertRequires,
  compareVersion,
  formatVersion,
  monthInHoChiMinh,
  nextVersion,
  parseScheme,
  parseTag,
  requiresFits,
} from "../scripts/maint/next-version.ts";
import { RelayError } from "../src/core/error.js";
import { gitCommit, withTempDir, withTempGitRepo } from "./helper.js";

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
  expect(
    nextVersion({ tags: ["v0.9.0", "v0.10.2", "v0.10.1"], now: october, major: false }).version,
  ).toBe("0.10.3");
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

test("assertRequires checks requires-atry across skills", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  expect(() => assertRequires(root, "0.10.0")).not.toThrow();
  expect(requiresFits(">=0.1.0", "0.10.0")).toBe(true);
  expect(requiresFits(">=0.10.0", "0.1.0")).toBe(false);

  await withTempDir(async (dir) => {
    const skills = join(dir, "skills", "test-skill");
    await mkdir(skills, { recursive: true });
    await writeFile(join(skills, "SKILL.md"), "requires-atry: \">=0.10.0\"\n");
    expect(() => assertRequires(dir, "0.1.0")).toThrow(/requires-atry is higher than 0.1.0/);
    await writeFile(join(skills, "SKILL.md"), "no requires\n");
    expect(() => assertRequires(dir, "0.1.0")).toThrow(/requires-atry missing/);
  });
});

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
let cliCase = 0;

async function runNext(args: string[], cwd = repoRoot) {
  const scriptPath = fileURLToPath(script);
  const previousArgv = process.argv;
  const previousExit = process.exit;
  const previousCwd = process.cwd();
  const previousStdout = process.stdout.write;
  const previousStderr = process.stderr.write;
  const stdout: string[] = [];
  const stderr: string[] = [];
  let status = 0;
  process.argv = [process.execPath, scriptPath, ...args];
  process.chdir(cwd);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  process.exit = ((code?: number) => {
    status = code ?? 0;
    throw new Error(`__exit__:${status}`);
  }) as typeof process.exit;
  try {
    cliCase += 1;
    await loadNext(cliCase);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.startsWith("__exit__:")) throw error;
  } finally {
    process.argv = previousArgv;
    process.exit = previousExit;
    process.chdir(previousCwd);
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }
  return { status, stdout: stdout.join(""), stderr: stderr.join("") };
}

function loadNext(id: number): Promise<unknown> {
  switch (id) {
    case 1:
      return import("../scripts/maint/next-version.ts?cli=1");
    case 2:
      return import("../scripts/maint/next-version.ts?cli=2");
    case 3:
      return import("../scripts/maint/next-version.ts?cli=3");
    case 4:
      return import("../scripts/maint/next-version.ts?cli=4");
    case 5:
      return import("../scripts/maint/next-version.ts?cli=5");
    case 6:
      return import("../scripts/maint/next-version.ts?cli=6");
    case 7:
      return import("../scripts/maint/next-version.ts?cli=7");
    case 8:
      return import("../scripts/maint/next-version.ts?cli=8");
    case 9:
      return import("../scripts/maint/next-version.ts?cli=9");
    case 10:
      return import("../scripts/maint/next-version.ts?cli=10");
    case 11:
      return import("../scripts/maint/next-version.ts?cli=11");
    case 12:
      return import("../scripts/maint/next-version.ts?cli=12");
    case 13:
      return import("../scripts/maint/next-version.ts?cli=13");
    default:
      throw new Error(`missing next-version import case ${id}`);
  }
}

test("the command prints the version and accepts CLI flags", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const first = await runNext(["--now", "2026-10-17T12:00:00.000Z"], dir);
    expect(first.status).toBe(0);
    expect(first.stdout).toBe("0.10.0\n");

    await execFileAsync("git", ["tag", "v0.10.0"], { cwd: dir });
    const result = await runNext(["--now", "2026-10-17T12:00:00.000Z"], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("0.10.1\n");

    const majorResult = await runNext(["--now", "2026-10-17T12:00:00.000Z", "--major"], dir);
    expect(majorResult.status).toBe(0);
    expect(majorResult.stdout).toBe("1.10.0\n");

    const november = await runNext(["--now", "2026-11-02T00:00:00.000Z"], dir);
    expect(november.status).toBe(0);
    expect(november.stdout).toBe("0.11.0\n");

    const checkResult = await runNext(["--check-requires", "0.10.0"], dir);
    expect(checkResult.status).toBe(0);
    expect(checkResult.stdout).toBe("");
  });
});

test("the command fails on invalid arguments", async () => {
  const badArg = await runNext(["--unknown"]);
  expect(badArg.status).not.toBe(0);
  expect(badArg.stderr).toContain("unknown argument");

  const badDate = await runNext(["--now", "invalid-date"]);
  expect(badDate.status).not.toBe(0);
  expect(badDate.stderr).toContain("now is not a date");

  const missingNow = await runNext(["--now"]);
  expect(missingNow.status).not.toBe(0);

  const missingCheck = await runNext(["--check-requires"]);
  expect(missingCheck.status).not.toBe(0);

  const lowRequires = await runNext(["--check-requires", "0.0.1"]);
  expect(lowRequires.status).not.toBe(0);
  expect(lowRequires.stderr).toContain("does not match X.M.Z");

  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    await execFileAsync("git", ["tag", "v0.10.99"], { cwd: dir });
    const zCap = await runNext(["--now", "2026-10-17T12:00:00.000Z"], dir);
    expect(zCap.status).not.toBe(0);
    expect(zCap.stderr).toContain("99");

    await execFileAsync("git", ["tag", "v1.0.1"], { cwd: dir });
    const badTag = await runNext(["--now", "2026-10-17T12:00:00.000Z"], dir);
    expect(badTag.status).not.toBe(0);
    expect(badTag.stderr).toContain("v1.0.1");

    await execFileAsync("git", ["tag", "-d", "v0.10.99", "v1.0.1"], { cwd: dir });
    await execFileAsync("git", ["tag", "v0.12.4"], { cwd: dir });
    const january = await runNext(["--now", "2027-01-15T00:00:00.000Z"], dir);
    expect(january.status).not.toBe(0);
    expect(january.stderr).toContain("major: true");
  });
});

test("compareVersion, parseScheme, parseTag, and monthInHoChiMinh handle all branches", () => {
  expect(parseScheme("1.2.3")).toEqual({ x: 1, m: 2, z: 3 });
  expect(parseScheme("0.10.1")).toEqual({ x: 0, m: 10, z: 1 });
  expect(() => parseScheme("bad")).toThrow(/does not match X.M.Z/);

  expect(parseTag("v0.10.1")).toEqual({ x: 0, m: 10, z: 1 });
  expect(parseTag("v1.12.99")).toEqual({ x: 1, m: 12, z: 99 });
  expect(() => parseTag("bad")).toThrow(/does not match vX.M.Z/);

  expect(formatVersion({ x: 0, m: 10, z: 5 })).toBe("0.10.5");
  expect(formatVersion({ x: 1, m: 3, z: 0 })).toBe("1.3.0");

  // x mismatch
  expect(compareVersion({ x: 0, m: 1, z: 0 }, { x: 1, m: 1, z: 0 })).toBe(-1);
  expect(compareVersion({ x: 1, m: 1, z: 0 }, { x: 0, m: 1, z: 0 })).toBe(1);
  // m mismatch (x equal)
  expect(compareVersion({ x: 0, m: 1, z: 0 }, { x: 0, m: 2, z: 0 })).toBe(-1);
  expect(compareVersion({ x: 0, m: 2, z: 0 }, { x: 0, m: 1, z: 0 })).toBe(1);
  // z mismatch (x and m equal)
  expect(compareVersion({ x: 0, m: 1, z: 1 }, { x: 0, m: 1, z: 2 })).toBe(-1);
  expect(compareVersion({ x: 0, m: 1, z: 2 }, { x: 0, m: 1, z: 1 })).toBe(1);
  // identical
  expect(compareVersion({ x: 0, m: 1, z: 1 }, { x: 0, m: 1, z: 1 })).toBe(0);

  expect(() => monthInHoChiMinh(new Date("invalid"))).toThrow(/now is not a date/);
});

test("nextVersion throws when version would not be higher than the highest tag", () => {
  // January 2027 (m=1) after a December 2026 (m=12) tag would not be higher.
  const jan2027 = new Date("2027-01-02T00:00:00.000Z");
  const err1 = (() => {
    try {
      nextVersion({ tags: ["v0.12.5"], now: jan2027, major: false });
    } catch (e) {
      return e;
    }
  })();
  expect(err1).toBeInstanceOf(RelayError);
  expect((err1 as RelayError).message).toMatch(/major: true/);

  // With major=true the version is higher (x increases).
  expect(nextVersion({ tags: ["v0.12.5"], now: jan2027, major: true }).version).toBe("1.1.0");

  // Same month, same x: Z increments; the result IS higher.
  expect(
    nextVersion({ tags: ["v0.10.0", "v0.10.2"], now: october, major: false }).version,
  ).toBe("0.10.3");
});

test("assertRequires passes for a temp root with a valid skill entry", async () => {
  await withTempDir(async (dir) => {
    const skill = join(dir, "skills", "my-skill");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "requires-atry: \">=0.1.0\"\n");
    await writeFile(join(dir, "skills", "notes.txt"), "skip\n");
    expect(() => assertRequires(dir, "0.10.0")).not.toThrow();
  });
});
