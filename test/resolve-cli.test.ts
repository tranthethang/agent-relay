import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runCli, withTempDir } from "./helper.js";
import { createdEvent, plannedState, runCache, runName, seedRelay, seedRun } from "./seed.js";

test("atry resolve prints the only run", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await realpath(
      await seedRun(relay, runName, runCache(plannedState), [createdEvent]),
    );
    const text = await runCli(["resolve"], root);
    expect(text.code).toBe(0);
    expect(text.stdout).toBe(`${runDir}\n`);
    const json = await runCli(["resolve", "--json"], root);
    expect(JSON.parse(json.stdout)).toEqual({
      schema: 1,
      path: runDir,
      name: runName,
      id: "1792208725",
      ymd: "20261017",
      slug: "next-state-cli-base",
    });
  });
});

test("atry resolve reports ambiguity and a missing run", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    await mkdir(join(relay, "20261018-1792208726-other-run"), { recursive: true });
    const ambiguous = await runCli(["resolve"], root);
    expect(ambiguous.code).toBe(3);
    const missing = await runCli(["--json", "resolve", "1792209999"], root);
    expect(missing.code).toBe(3);
    expect(JSON.parse(missing.stdout || "null")).toBeNull();
    expect(JSON.parse(missing.stderr)).toMatchObject({
      schema: 1,
      error: { code: "not_found", path: "1792209999" },
    });
  });
});

test("atry resolve rejects a conflicting --run", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    const result = await runCli(["resolve", runName, "--run", "1792208726"], root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("run:");
  });
});
