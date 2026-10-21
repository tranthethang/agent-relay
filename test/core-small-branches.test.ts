import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ZodError } from "zod";
import { formatIssuePath, fromZod } from "../src/core/error.js";
import { outsidePaths } from "../src/core/scope.js";
import { oneToken, selectRun } from "../src/core/select.js";
import { withTempDir } from "./helper.js";

test("formatIssuePath renders a symbol key with String()", () => {
  expect(formatIssuePath(["files", Symbol("odd key")])).toBe(
    `files[${JSON.stringify("Symbol(odd key)")}]`,
  );
});

test("fromZod falls back when the error has no issues", () => {
  const error = fromZod(new ZodError([]));
  expect(error).toMatchObject({ code: "validation", message: "validation failed", fieldPath: "" });
});

test("selectRun reports not_found when the relay dir holds no runs", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, ".agent-relay"), { recursive: true });
    await expect(selectRun(root, undefined)).rejects.toMatchObject({
      code: "not_found",
      message: "run not found",
    });
  });
});

test("outsidePaths lists a repeated changed path once", () => {
  expect(outsidePaths(["src/extra.ts", "src\\extra.ts", "src/extra.ts"], [], [])).toEqual([
    "src/extra.ts",
  ]);
});

test("selectRun picks the token, the only run, or reports ambiguity", async () => {
  await withTempDir(async (root) => {
    const relay = join(root, ".agent-relay");
    const runA = "20261017-1792208724-select-one";
    const runB = "20261017-1792208725-select-two";
    await mkdir(join(relay, runA), { recursive: true });
    expect(await selectRun(root, undefined)).toBe(join(relay, runA));
    await mkdir(join(relay, runB), { recursive: true });
    expect(await selectRun(root, "1792208725")).toBe(join(relay, runB));
    await expect(selectRun(root, undefined)).rejects.toMatchObject({ code: "ambiguous" });
  });
});

test("oneToken accepts matching tokens and refuses differing ones", () => {
  expect(oneToken("a", undefined)).toBe("a");
  expect(oneToken(undefined, "b")).toBe("b");
  expect(oneToken("c", "c")).toBe("c");
  expect(oneToken(undefined, undefined)).toBeUndefined();
  expect(() => oneToken("a", "b")).toThrow("--run and the run argument differ");
});
