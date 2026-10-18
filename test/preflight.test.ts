import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { RelayError } from "../src/core/error.js";
import { installCommand, preflightResult, versionMeets } from "../src/core/preflight.js";
import { runCli, withTempGitRepo } from "./helper.js";

const installed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

test("an equal version meets the range", () => {
  expect(versionMeets("0.10.2", ">=0.10.2")).toBe(true);
});

test("a higher version meets the range", () => {
  expect(versionMeets("0.10.2", ">=0.1.0")).toBe(true);
  expect(versionMeets("1.0.0", ">=0.10.2")).toBe(true);
});

test("a lower version misses the range", () => {
  expect(versionMeets("0.0.0", ">=0.1.0")).toBe(false);
  expect(versionMeets("0.10.1", ">=0.10.2")).toBe(false);
});

test("a bad range is a usage error", () => {
  expect(() => versionMeets("0.10.2", ">0.1.0")).toThrow(RelayError);
  expect(() => versionMeets("0.10.2", ">=1.0")).toThrow(/requires must be >=X\.Y\.Z/);
  try {
    versionMeets("0.10.2", ">=00.1.0");
  } catch (error) {
    expect(error).toBeInstanceOf(RelayError);
    expect((error as RelayError).code).toBe("usage");
  }
});

test("preflight exits 0 when the installed version is equal", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["preflight", "--requires", `>=${installed.version}`], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

test("preflight exits usage and prints the install command when the version is lower", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["preflight", "--requires", ">=99.1.0"], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe(`${installCommand}\n`);
    expect(result.stderr).toBe("");
  });
});

test("preflight --json reports ok, installed, and required", async () => {
  await withTempGitRepo(async (dir) => {
    const met = await runCli(["preflight", "--requires", `>=${installed.version}`, "--json"], dir);
    expect(met.code).toBe(0);
    expect(JSON.parse(met.stdout)).toEqual(
      preflightResult(installed.version, `>=${installed.version}`),
    );

    const missed = await runCli(["preflight", "--requires", ">=99.1.0", "--json"], dir);
    expect(missed.code).toBe(1);
    expect(JSON.parse(missed.stdout)).toEqual({
      schema: 1,
      ok: false,
      installed: installed.version,
      required: ">=99.1.0",
    });
  });
});

test("preflight refuses a bad range with usage", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["preflight", "--requires", ">=1", "--json"], dir);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "usage", path: "requires" },
    });
  });
});
