import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { skillMinimumRange, skillMinimumVersion } from "../scripts/maint/next-version.ts";
import { RelayError } from "../src/core/error.js";
import {
  installCommandFor,
  preflightResult,
  preflightText,
  versionMeets,
} from "../src/core/preflight.js";
import { runCli, withTempGitRepo } from "./helper.js";

const olderThanFloor = "0.1.0";
// `npm test` builds first, so the CLI reports the dev build version.
const built = JSON.parse(
  readFileSync(new URL("../dist/package.json", import.meta.url), "utf8"),
) as {
  version: string;
};
const base = built.version.replace(/-dev$/, "");

async function withDevEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.ATRY_DEV;
  process.env.ATRY_DEV = "1";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.ATRY_DEV;
    else process.env.ATRY_DEV = previous;
  }
}

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

test("preflightResult refuses a dev build without consent", () => {
  expect(preflightResult(`${skillMinimumVersion}-dev`, `>=${base}`)).toEqual({
    schema: 1,
    ok: false,
    installed: `${skillMinimumVersion}-dev`,
    required: `>=${base}`,
    dev: true,
  });
  expect(preflightResult(`${skillMinimumVersion}-dev`, ">=0.1.0", true).ok).toBe(true);
  expect(preflightResult(`${skillMinimumVersion}-dev`, ">=99.0.0", true).ok).toBe(false);
});

test("preflightResult reads a release version without a marker", () => {
  expect(preflightResult(base, `>=${base}`)).toEqual({
    schema: 1,
    ok: true,
    installed: base,
    required: `>=${base}`,
  });
});

test("installCommandFor names the required release", () => {
  expect(installCommandFor(skillMinimumRange)).toBe(
    `npm i -g @tranthethang/agent-relay@${skillMinimumVersion}`,
  );
  expect(() => installCommandFor(skillMinimumVersion)).toThrow(RelayError);
  expect(preflightText(preflightResult(olderThanFloor, skillMinimumRange))).toBe(
    `requires: ${skillMinimumRange}\ninstall: npm i -g @tranthethang/agent-relay@${skillMinimumVersion}\n`,
  );
  expect(preflightText(preflightResult(skillMinimumVersion, skillMinimumRange))).toBe("");
});

test("preflight refuses the dev build without consent", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["preflight", "--requires", `>=${base}`], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      `requires: >=${base}\ninstall: ${installCommandFor(`>=${base}`)}\n`,
    );
    expect(result.stderr).toBe("");
  });
});

test("preflight accepts the dev build with ATRY_DEV or --allow-dev", async () => {
  await withTempGitRepo(async (dir) => {
    const viaEnv = await withDevEnv(() => runCli(["preflight", "--requires", `>=${base}`], dir));
    expect(viaEnv.code).toBe(0);
    expect(viaEnv.stdout).toBe("");
    const viaFlag = await runCli(["preflight", "--requires", `>=${base}`, "--allow-dev"], dir);
    expect(viaFlag.code).toBe(0);
    expect(viaFlag.stdout).toBe("");
  });
});

test("preflight exits usage and prints the install command when the version is lower", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["preflight", "--requires", ">=99.1.0", "--allow-dev"], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      "requires: >=99.1.0\ninstall: npm i -g @tranthethang/agent-relay@99.1.0\n",
    );
    expect(result.stderr).toBe("");
  });
});

test("preflight --json reports ok, installed, required, and dev", async () => {
  await withTempGitRepo(async (dir) => {
    const met = await runCli(
      ["preflight", "--requires", `>=${base}`, "--allow-dev", "--json"],
      dir,
    );
    expect(met.code).toBe(0);
    expect(JSON.parse(met.stdout)).toEqual(
      preflightResult(built.version, `>=${base}`, true),
    );

    const refused = await runCli(["preflight", "--requires", `>=${base}`, "--json"], dir);
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout)).toEqual({
      schema: 1,
      ok: false,
      installed: built.version,
      required: `>=${base}`,
      dev: true,
    });

    const missed = await runCli(
      ["preflight", "--requires", ">=99.1.0", "--allow-dev", "--json"],
      dir,
    );
    expect(missed.code).toBe(1);
    expect(JSON.parse(missed.stdout)).toEqual({
      schema: 1,
      ok: false,
      installed: built.version,
      required: ">=99.1.0",
      dev: true,
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
