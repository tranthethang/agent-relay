import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";

test("atry approve records via and marks the run approved", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "approve-run",
      "--title",
      "Approve",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string; id: string };
    const approved = await runCli(["--run", run.id, "approve", "--via", "confirm", "--json"], dir);
    expect(approved.code).toBe(0);
    expect(JSON.parse(approved.stdout)).toMatchObject({ approved: true, lifecycle: "approved" });
    const lines = (await readFile(join(run.path, "events.jsonl"), "utf8")).trim().split("\n");
    const event = JSON.parse(lines[lines.length - 1] ?? "") as { action: string; via: string };
    expect(event).toMatchObject({ stage: "plan", action: "approved", via: "confirm" });
    const bad = await runCli(["approve", run.path, "--via", "chat"], dir);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("via:");
  });
});
