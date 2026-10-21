import * as childProcess from "node:child_process";
import * as fsPromises from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { RelayError } from "../src/core/error.js";
import { atomicWrite, readJsonl, readText } from "../src/core/files.js";
import { gitHead, gitProgramFor, gitRoot, workTree } from "../src/core/git.js";
import { versionMeets } from "../src/core/preflight.js";
import { packageVersion } from "../src/version.js";
import { withTempDir } from "./helper.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename), copyFile: vi.fn(actual.copyFile) };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

type GitCallback = (error: unknown, stdout: string) => void;

function fakeGit(reply: (args: string[]) => { error: unknown; stdout: string }): void {
  vi.mocked(childProcess.execFile).mockImplementation(
    ((
      _file: string,
      args: string[],
      _options: unknown,
      callback: GitCallback,
    ) => {
      const { error, stdout } = reply(args);
      queueMicrotask(() => callback(error, stdout));
      return { stdin: null };
    }) as unknown as typeof childProcess.execFile,
  );
}

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

afterEach(() => {
  vi.mocked(childProcess.execFile).mockRestore();
  vi.mocked(fsPromises.rename).mockRestore();
  vi.mocked(fsPromises.copyFile).mockRestore();
});

test("readJsonl reads an empty file, a missing trailing newline, and rejects a blank line", async () => {
  await withTempDir(async (dir) => {
    const empty = join(dir, "empty.jsonl");
    await writeFile(empty, "", "utf8");
    expect(await readJsonl(empty)).toEqual([]);

    const noNewline = join(dir, "tail.jsonl");
    await writeFile(noNewline, "{\"a\":1}\n{\"b\":2}", "utf8");
    expect(await readJsonl(noNewline)).toEqual([{ a: 1 }, { b: 2 }]);

    const blank = join(dir, "blank.jsonl");
    await writeFile(blank, "{\"a\":1}\n\n{\"b\":2}\n", "utf8");
    await expect(readJsonl(blank)).rejects.toMatchObject({
      code: "validation",
      fieldPath: `${blank}:lines[1]`,
    });
  });
});

test("atomicWrite retries a busy rename and then succeeds", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "run.json");
    vi.mocked(fsPromises.rename).mockRejectedValueOnce(codeError("EBUSY"));
    await atomicWrite(filePath, "ok\n");
    expect(await readText(filePath)).toBe("ok\n");
    expect(vi.mocked(fsPromises.rename)).toHaveBeenCalledTimes(2);
  });
});

test("atomicWrite gives up after the last retry delay", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "run.json");
    const busy = codeError("EPERM");
    vi.mocked(fsPromises.rename).mockRejectedValue(busy);
    await expect(atomicWrite(filePath, "x\n")).rejects.toBe(busy);
    expect(vi.mocked(fsPromises.rename)).toHaveBeenCalledTimes(6);
  });
});

test("atomicWrite rethrows a rename failure that is not an Error", async () => {
  await withTempDir(async (dir) => {
    vi.mocked(fsPromises.rename).mockRejectedValue("boom");
    await expect(atomicWrite(join(dir, "run.json"), "x\n")).rejects.toBe("boom");
    expect(vi.mocked(fsPromises.rename)).toHaveBeenCalledTimes(1);
  });
});

test("gitProgramFor picks the Git path for each platform", () => {
  expect(gitProgramFor("win32")).toBe(String.raw`C:\Program Files\Git\cmd\git.exe`);
  expect(gitProgramFor("linux")).toBe("/usr/bin/git");
  expect(gitProgramFor("darwin")).toBe("/usr/bin/git");
});

test("gitHead rejects an empty HEAD", async () => {
  fakeGit(() => ({ error: null, stdout: "\n" }));
  await expect(gitHead("/nowhere")).rejects.toMatchObject({
    code: "validation",
    message: "git HEAD not found",
  });
});

test("git maps a failure that is not an Error", async () => {
  fakeGit(() => ({ error: "failed", stdout: "" }));
  await expect(gitRoot("/nowhere")).rejects.toBeInstanceOf(RelayError);
});

test("workTree fails when the index copy fails for a reason other than ENOENT", async () => {
  await withTempDir(async (dir) => {
    fakeGit((args) => {
      if (args.includes("--show-toplevel")) return { error: null, stdout: `${dir}\n` };
      return { error: null, stdout: "index\n" };
    });
    vi.mocked(fsPromises.copyFile).mockRejectedValueOnce(codeError("EACCES"));
    await expect(workTree(dir)).rejects.toMatchObject({
      code: "validation",
      message: "git working tree hash failed",
    });
  });
});

test("versionMeets rejects an installed version that is not X.Y.Z", () => {
  expect(() => versionMeets("1.2", ">=1.0.0")).toThrow("installed version must be X.Y.Z");
  expect(versionMeets("1.2.3", ">=1.2.3")).toBe(true);
  expect(versionMeets("1.3.0", ">=1.2.9")).toBe(true);
  expect(versionMeets("1.2.2", ">=1.2.3")).toBe(false);
});

test("packageVersion fails when package.json has no version", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "dist"));
    await writeFile(join(dir, "package.json"), "{}\n", "utf8");
    const moduleUrl = pathToFileURL(join(dir, "dist", "atry.js")).href;
    expect(() => packageVersion(moduleUrl)).toThrow("package.json version is missing");
    await writeFile(join(dir, "package.json"), "{\"version\":\"\"}\n", "utf8");
    expect(() => packageVersion(moduleUrl)).toThrow("package.json version is missing");
  });
});
