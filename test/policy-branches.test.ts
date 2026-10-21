import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { findRelayDir, resolveRun, runIdFromName } from "../src/core/discover.js";
import { RelayError } from "../src/core/error.js";
import { modelLine } from "../src/core/model.js";
import {
  checkPolicy,
  initPolicy,
  parsePolicy,
  readPolicy,
  validateWorktreeDir,
} from "../src/core/policy.js";
import { gitCommit, withTempDir, withTempGitRepo } from "./helper.js";

type Fault = (name: string, path: string) => unknown;

const faults = vi.hoisted(() => ({
  fs: undefined as Fault | undefined,
  exec: undefined as (() => unknown) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const wrap = <F extends (...args: never[]) => Promise<unknown>>(name: string, fn: F): F =>
    (async (...args: Parameters<F>) => {
      const error = faults.fs?.(name, String(args[0]));
      if (error !== undefined) throw error;
      return fn(...args);
    }) as F;
  return {
    ...actual,
    readFile: wrap("readFile", actual.readFile),
    writeFile: wrap("writeFile", actual.writeFile),
    realpath: wrap("realpath", actual.realpath),
    stat: wrap("stat", actual.stat),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify: promisifyActual } = await import("node:util");
  const real = promisifyActual(actual.execFile);
  const execFile = (...args: Parameters<typeof actual.execFile>) => actual.execFile(...args);
  Object.defineProperty(execFile, promisifyActual.custom, {
    value: (...args: Parameters<typeof real>) => {
      const error = faults.exec?.();
      return error === undefined ? real(...args) : Promise.reject(error);
    },
  });
  return { ...actual, execFile };
});

afterEach(() => {
  faults.fs = undefined;
  faults.exec = undefined;
});

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

const runA = "20261017-1792208724-next-core-schemas";

// model.ts

test("modelLine strips a trailing number joined to a letter", () => {
  expect(modelLine("abc5")).toBe("abc");
});

test("modelLine strips underscore and dot version separators", () => {
  expect(modelLine("abc_5")).toBe("abc");
  expect(modelLine("abc.5")).toBe("abc");
});

test("modelLine strips trailing separators without a version", () => {
  expect(modelLine("claude-")).toBe("claude");
});

// discover.ts

test("runIdFromName returns an empty id without a dash", () => {
  expect(runIdFromName("nodash")).toBe("");
});

test("resolveRun rejects a run directory name that does not exist", async () => {
  await withTempDir(async (root) => {
    const relay = join(root, ".agent-relay");
    await mkdir(relay);
    await expect(resolveRun(relay, runA, root)).rejects.toMatchObject({ code: "not_found" });
  });
});

test("resolveRun rejects a path token that is missing or not a run", async () => {
  await withTempDir(async (root) => {
    const relay = join(root, ".agent-relay");
    await mkdir(join(root, "plain"), { recursive: true });
    await mkdir(relay);
    await expect(resolveRun(relay, "./missing", root)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(resolveRun(relay, "./plain", root)).rejects.toMatchObject({ code: "not_found" });
  });
});

test("resolveRun finds a run by id and by slug", async () => {
  await withTempDir(async (root) => {
    const relay = join(root, ".agent-relay");
    await mkdir(join(relay, runA), { recursive: true });
    expect(await resolveRun(relay, "1792208724", root)).toBe(join(relay, runA));
    expect(await resolveRun(relay, "next-core-schemas", root)).toBe(join(relay, runA));
  });
});

test("findRelayDir rethrows stat errors other than ENOENT", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "a"));
    faults.fs = (name, path) =>
      name === "stat" && path.endsWith(".git") ? codeError("EACCES") : undefined;
    await expect(findRelayDir(join(root, "a"))).rejects.toMatchObject({ code: "EACCES" });
    faults.fs = (name, path) =>
      name === "stat" && path.endsWith(".agent-relay") ? codeError("EACCES") : undefined;
    await expect(findRelayDir(join(root, "a"))).rejects.toMatchObject({ code: "EACCES" });
  });
});

// policy.ts

test("readPolicy reports a read failure without git stderr", async () => {
  await withTempGitRepo(async (dir) => {
    faults.exec = () => new Error("boom");
    await expect(readPolicy(dir, "HEAD")).rejects.toMatchObject({
      code: "validation",
      message: "could not read policy from base",
    });
    faults.exec = () => "not an error";
    await expect(readPolicy(dir, "HEAD")).rejects.toBeInstanceOf(RelayError);
  });
});

test("parsePolicy reports a root-level schema error at the file", () => {
  expect(() => parsePolicy("[]")).toThrow(
    expect.objectContaining({ code: "validation", fieldPath: ".agent-relay.json" }),
  );
});

test("initPolicy rethrows write errors other than EEXIST", async () => {
  await withTempGitRepo(async (dir) => {
    faults.fs = (name) => name === "writeFile" ? codeError("EACCES") : undefined;
    await expect(initPolicy(dir)).rejects.toMatchObject({ code: "EACCES" });
  });
});

test("checkPolicy rethrows read errors other than ENOENT", async () => {
  await withTempGitRepo(async (dir) => {
    faults.fs = (name) => name === "readFile" ? codeError("EACCES") : undefined;
    await expect(checkPolicy(dir)).rejects.toMatchObject({ code: "EACCES" });
  });
});

test("validateWorktreeDir rethrows realpath errors other than ENOENT", async () => {
  await withTempDir(async (root) => {
    faults.fs = (name, path) =>
      name === "realpath" && path !== root ? codeError("EACCES") : undefined;
    await expect(validateWorktreeDir(root, "../outside")).rejects.toMatchObject({
      code: "EACCES",
    });
  });
});

test("validateWorktreeDir stops at the filesystem root when nothing exists", async () => {
  await withTempDir(async (tmp) => {
    const root = await realpath(tmp);
    faults.fs = (name, path) =>
      name === "realpath" && path !== root ? codeError("ENOENT") : undefined;
    await expect(validateWorktreeDir(root, "../outside")).resolves.toBeUndefined();
    await expect(validateWorktreeDir(root, "inside")).rejects.toMatchObject({
      code: "validation",
    });
  });
});

test("the fs and git mocks pass through by default", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(join(dir, "x.txt"), "x\n");
    await gitCommit(dir);
    await expect(readPolicy(dir, "HEAD")).resolves.toMatchObject({ schema: 1 });
  });
});

test("initPolicy writes the template once and checkPolicy reads it back", async () => {
  await withTempGitRepo(async (dir) => {
    await expect(checkPolicy(dir)).rejects.toMatchObject({ code: "not_found" });
    const { path } = await initPolicy(dir);
    await expect(initPolicy(dir)).rejects.toMatchObject({ code: "gate" });
    await writeFile(
      path,
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 1,
        worktree: { enabled: true, dir: "../wt" },
      }),
    );
    await expect(checkPolicy(dir)).resolves.toMatchObject({
      policy: { worktree: { enabled: true, dir: "../wt" } },
    });
  });
});
