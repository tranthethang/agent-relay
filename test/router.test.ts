import { expect, test, vi } from "vitest";
import { reportFailure } from "../src/cli/fail.js";
import { RelayError } from "../src/core/error.js";
import { runCli, withTempDir } from "./helper.js";

test("reportFailure maps a RelayError to its exit code", () => {
  const stderr: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  const code = reportFailure(new RelayError("not_found", "run not found", "run"), false);
  spy.mockRestore();
  expect(code).toBe(3);
  expect(stderr).toEqual(["run: run not found\n"]);
});

test("reportFailure maps an unknown error to usage", () => {
  const stderr: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  const code = reportFailure(new Error("boom"), true);
  spy.mockRestore();
  expect(code).toBe(1);
  expect(JSON.parse(stderr[0] ?? "")).toMatchObject({
    schema: 1,
    error: { code: "usage", message: "boom", path: "" },
  });
});

test("atry accepts global --json and --run", async () => {
  await withTempDir(async (dir) => {
    const after = await runCli(["version", "--json", "--run", "1792208725"], dir);
    expect(after.code).toBe(0);
    expect(JSON.parse(after.stdout)).toMatchObject({ schema: 1 });
    const before = await runCli(["--json", "version"], dir);
    expect(before.code).toBe(0);
    expect(JSON.parse(before.stdout)).toMatchObject({ schema: 1 });
  });
});

test("atry maps an unknown command to exit 1", async () => {
  await withTempDir(async (dir) => {
    const result = await runCli(["no-such-command"], dir);
    expect(result.code).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
