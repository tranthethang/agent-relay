import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

test("task done and skip require the claim owner", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "claim-owner");
    await writeTasks(run, [
      { title: "First", files: ["src/a.ts"] },
      { title: "Second", files: ["src/b.ts"] },
      { title: "Third", files: ["src/c.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await startImplement(dir, run);
    expect((await runCli(["task", "start", run, "T1"], dir)).code).toBe(0);
    expect((await runCli(["task", "done", run, "T1"], dir)).code).toBe(0);
    expect((await runCli(["claim", run, "T2", "--session", "alice"], dir)).code).toBe(0);
    const missing = await runCli(["task", "done", run, "T2"], dir);
    expect(missing.code).toBe(5);
    expect(missing.stderr).toContain("locks/T2.lock: lock held by alice");
    const wrong = await runCli(
      ["task", "skip", run, "T2", "--session", "bob", "--reason", "no"],
      dir,
    );
    expect(wrong.code).toBe(5);
    expect((await runCli(["task", "done", run, "T2", "--session", "alice"], dir)).code).toBe(0);
    await expect(access(join(run, "locks", "T2.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await runCli(["claim", run, "T3", "--session", "alice"], dir)).code).toBe(0);
    const skipped = await runCli([
      "task",
      "skip",
      run,
      "T3",
      "--session",
      "alice",
      "--reason",
      "drop",
    ], dir);
    expect(skipped.code).toBe(0);
    await expect(access(join(run, "locks", "T3.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
