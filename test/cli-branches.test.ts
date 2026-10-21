import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { registerCommands, reviewsForNext } from "../src/cli/commands.js";
import { reportFailure } from "../src/cli/fail.js";
import { RelayError } from "../src/core/error.js";
import { withTempDir } from "./helper.js";

const mocks = vi.hoisted(() => ({
  reviewIntegrity: vi.fn(),
  statError: undefined as Error | undefined,
}));

vi.mock("../src/core/lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/lifecycle.js")>();
  return { ...actual, reviewIntegrity: mocks.reviewIntegrity };
});

vi.mock("../src/core/select.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/select.js")>();
  return { ...actual, selectRun: vi.fn(async (_cwd: string, token: string) => token) };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: vi.fn(async (...args: Parameters<typeof actual.stat>) => {
      if (mocks.statError !== undefined) throw mocks.statError;
      return actual.stat(...args);
    }),
  };
});

afterEach(() => {
  mocks.statError = undefined;
  mocks.reviewIntegrity.mockReset();
});

function program(): Command {
  const root = new Command();
  root.exitOverride();
  root.configureOutput({ outputError() {}, writeErr() {} });
  root.option("--json", "print JSON");
  root.option("--run <run>", "run id, slug, name, or path");
  registerCommands(root);
  return root;
}

async function parseError(args: string[]): Promise<unknown> {
  try {
    await program().parseAsync(args, { from: "user" });
  } catch (error) {
    return error;
  }
  throw new Error(`no error for ${args.join(" ")}`);
}

test("reportFailure maps a non-Error throw to usage text", () => {
  const stderr: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  const code = reportFailure("boom", false);
  spy.mockRestore();
  expect(code).toBe(1);
  expect(stderr).toEqual(["unknown error\n"]);
});

test("next requires a run", async () => {
  const error = await parseError(["next"]);
  expect(error).toMatchObject({ code: "usage", message: "run is required" });
});

test("approve requires --via without --preview", async () => {
  const error = await parseError(["approve", "/some/run"]);
  expect(error).toMatchObject({ code: "usage", message: "via is required" });
});

test("close requires a run", async () => {
  const error = await parseError(["close"]);
  expect(error).toMatchObject({ code: "usage", message: "run is required" });
});

test("claim steal rejects a non-numeric ttl", async () => {
  const error = await parseError(["steal", "/some/run", "T1", "--session", "s", "--ttl", "abc"]);
  expect(error).toMatchObject({ code: "usage", message: "ttl must be a non-negative number" });
});

test("brainstorm done rejects a file, a missing path, and passes other stat errors", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "note.txt");
    await writeFile(file, "x");
    expect(await parseError(["brainstorm", "done", file])).toMatchObject({
      code: "not_found",
      message: "brainstorm not found",
    });
    expect(await parseError(["brainstorm", "done", join(dir, "missing")])).toMatchObject({
      code: "not_found",
      message: "brainstorm not found",
    });
    await mkdir(join(dir, "real"));
    mocks.statError = Object.assign(new Error("denied"), { code: "EACCES" });
    expect(await parseError(["brainstorm", "done", join(dir, "real")])).toBe(mocks.statError);
  });
});

test("reviewsForNext skips known read failures and rethrows others", async () => {
  expect(await reviewsForNext("/r", "base", [], "implementing")).toBeUndefined();
  for (const message of ["could not read policy from base", "git index not found"]) {
    mocks.reviewIntegrity.mockRejectedValueOnce(new RelayError("validation", message));
    expect(await reviewsForNext("/r", "base", [], "reviewing")).toBeUndefined();
  }
  const other = new RelayError("validation", "other failure");
  mocks.reviewIntegrity.mockRejectedValueOnce(other);
  await expect(reviewsForNext("/r", "base", [], "reviewing")).rejects.toBe(other);
  const plain = new Error("git index not found");
  mocks.reviewIntegrity.mockRejectedValueOnce(plain);
  await expect(reviewsForNext("/r", "base", [], "reviewing")).rejects.toBe(plain);
  mocks.reviewIntegrity.mockResolvedValueOnce([]);
  expect(await reviewsForNext("/r", "base", [], "reviewing")).toEqual([]);
});
