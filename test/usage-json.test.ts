import { CommanderError } from "commander";
import { expect, test, vi } from "vitest";
import { reportFailure } from "../src/cli/fail.js";
import { exitCodes } from "../src/core/error.js";
import { runCli, withTempDir } from "./helper.js";

test("reportFailure maps a commander error to usage", () => {
  const stderr: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  const code = reportFailure(
    new CommanderError(1, "commander.error", "error: unknown command 'nope'"),
    true,
  );
  spy.mockRestore();
  expect(code).toBe(exitCodes.usage);
  expect(JSON.parse(stderr[0] ?? "")).toEqual({
    schema: 1,
    error: { code: "usage", message: "error: unknown command 'nope'", path: "" },
  });
});

test("reportFailure leaves a help exit unchanged", () => {
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const code = reportFailure(
    new CommanderError(0, "commander.helpDisplayed", "(outputHelp)"),
    true,
  );
  spy.mockRestore();
  expect(code).toBe(0);
  expect(spy).not.toHaveBeenCalled();
});

test("usage errors print usage JSON under --json and text without it", async () => {
  await withTempDir(async (dir) => {
    const cases = [
      ["no-such-command"],
      ["--no-such-option"],
      ["--run"],
    ];
    for (const args of cases) {
      const text = await runCli(args, dir);
      expect(text.code).toBe(exitCodes.usage);
      expect(text.stdout).toBe("");
      expect(text.stderr).toMatch(/^error: .+\n$/);

      const json = await runCli(["--json", ...args], dir);
      expect(json.code).toBe(exitCodes.usage);
      expect(json.stdout).toBe("");
      expect(JSON.parse(json.stderr)).toMatchObject({
        schema: 1,
        error: { code: "usage", path: "" },
      });
    }
  });
});

test("help stays text and exits 0", async () => {
  await withTempDir(async (dir) => {
    const help = await runCli(["--help"], dir);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage:");
    const command = await runCli(["help", "version"], dir);
    expect(command.code).toBe(0);
    expect(command.stdout).toContain("version");
    const json = await runCli(["--help", "--json"], dir);
    expect(json.code).toBe(0);
    expect(json.stdout).toContain("Usage:");
    expect(json.stderr).toBe("");
  });
});

test("a missing subcommand prints help text, or usage JSON under --json", async () => {
  await withTempDir(async (dir) => {
    for (const args of [[], ["plan"]]) {
      const text = await runCli(args, dir);
      expect(text.code).toBe(exitCodes.usage);
      expect(text.stderr).toContain("Usage:");
      expect(text.stderr).not.toContain("(outputHelp)");

      const json = await runCli(["--json", ...args], dir);
      expect(json.code).toBe(exitCodes.usage);
      expect(JSON.parse(json.stderr)).toEqual({
        schema: 1,
        error: { code: "usage", message: "error: missing command", path: "" },
      });
    }
  });
});
