import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { policyTemplate } from "../src/core/policy.js";
import { runCli, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

test("policy init writes the template at the git root", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["policy", "init"], dir);
    expect(result.code).toBe(0);
    const text = await readFile(join(dir, ".agent-relay.json"), "utf8");
    expect(JSON.parse(text)).toEqual(policyTemplate);
    expect(text.endsWith("}\n")).toBe(true);
    expect(result.stdout).toContain("commit the file to apply it");
  });
});

test("policy init refuses when the file exists and keeps it", async () => {
  await withTempGitRepo(async (dir) => {
    expect((await runCli(["policy", "init"], dir)).code).toBe(0);
    const path = join(dir, ".agent-relay.json");
    await writeFile(path, "{\"keep\":true}\n");
    const result = await runCli(["policy", "init"], dir);
    expect(result.code).toBe(4);
    expect(await readFile(path, "utf8")).toBe("{\"keep\":true}\n");
  });
});

test("policy init from a subdirectory writes at the git root", async () => {
  await withTempGitRepo(async (dir) => {
    const sub = join(dir, "a", "b");
    await mkdir(sub, { recursive: true });
    expect((await runCli(["policy", "init"], sub)).code).toBe(0);
    expect(JSON.parse(await readFile(join(dir, ".agent-relay.json"), "utf8"))).toEqual(
      policyTemplate,
    );
  });
});

test("policy check passes on the file that init writes", async () => {
  await withTempGitRepo(async (dir) => {
    await runCli(["policy", "init"], dir);
    const result = await runCli(["policy", "check"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^ok: .*\.agent-relay\.json\n$/);
  });
});

test("policy check reports not_found when the file is missing", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["policy", "check"], dir);
    expect(result.code).toBe(3);
  });
});

test("policy check reports the field path of a wrong type", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 0,
        worktree: { enabled: "yes" },
      }),
    );
    const result = await runCli(["policy", "check", "--json"], dir);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "validation", path: ".agent-relay.json:worktree.enabled" },
    });
  });
});

test("policy init does not stage the file", async () => {
  await withTempGitRepo(async (dir) => {
    await runCli(["policy", "init"], dir);
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: dir });
    expect(stdout).toBe("?? .agent-relay.json\n");
  });
});
