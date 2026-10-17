import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { runCli, withTempGitRepo } from "./helper.js";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

test("atry version prints the version text", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["version"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${version.version}\n`);
    expect(result.stderr).toBe("");
  });
});

test("atry version --json prints schema 1", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["version", "--json"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify({ schema: 1, version: version.version })}\n`);
    expect(result.stderr).toBe("");
  });
});
