import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

test("list shows status, owner, and blocked deps", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "claim-list");
    await writeTasks(run, [
      { title: "First", files: ["src/a.ts"] },
      { title: "Second", deps: ["T1"], files: ["src/b.ts"] },
      { title: "Third", deps: ["T1", "T2"], files: ["src/c.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await startImplement(dir, run);
    expect((await runCli(["claim", run, "T1", "--session", "alice"], dir)).code).toBe(0);
    const listed = await runCli(["list", run, "--json"], dir);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      tasks: [
        { id: "T1", status: "in-progress", owner: "alice", blocked: [] },
        { id: "T2", status: "pending", blocked: ["T1"] },
        { id: "T3", status: "pending", blocked: ["T1", "T2"] },
      ],
    });
    const text = await runCli(["list", run], dir);
    expect(text.stdout).toContain("T1: in-progress owner=alice");
    expect(text.stdout).toContain("T2: pending blocked: T1");
    expect(text.stdout).toContain("T3: pending blocked: T1 T2");
    expect((await runCli(["task", "done", run, "T1", "--session", "alice"], dir)).code).toBe(0);
    expect((await runCli(["task", "skip", run, "T2", "--reason", "later"], dir)).code).toBe(0);
    const clear = await runCli(["list", run], dir);
    expect(clear.stdout).toContain("T1: done");
    expect(clear.stdout).toContain("T3: pending");
    expect(clear.stdout).not.toContain("blocked:");
  });
});
