import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { closeRun, completeReview, mustCli } from "./e2e.js";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

test("two sessions finish tasks, review in two tools, and close", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "par-cutover");
    await writeTasks(run, [
      { title: "Core file", files: ["src/core/claim.ts"] },
      { title: "Core dir", files: ["src/core"] },
    ]);
    await mustCli(["plan", "done", run], dir);
    await startImplement(dir, run);
    const alice = await mustCli(["claim", run, "T1", "--session", "alice", "--json"], dir);
    expect(JSON.parse(alice.stdout)).toMatchObject({
      task: "T1",
      session: "alice",
      action: "claimed",
    });
    const overlap = await runCli(["claim", run, "T2", "--session", "bob"], dir);
    expect(overlap.code).toBe(5);
    expect(overlap.stderr).toContain("T2.files: overlaps T1");
    await expect(access(join(run, "locks", "T2.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    const released = await mustCli(
      ["release", run, "T1", "--session", "alice", "--json"],
      dir,
    );
    expect(JSON.parse(released.stdout)).toMatchObject({
      task: "T1",
      session: "alice",
      action: "released",
    });
    const again = await mustCli(["claim", run, "T1", "--session", "alice", "--json"], dir);
    expect(JSON.parse(again.stdout)).toMatchObject({ task: "T1", session: "alice" });
    await mustCli(["task", "done", run, "T1", "--session", "alice"], dir);

    const bob = await mustCli(["claim", run, "T2", "--session", "bob", "--json"], dir);
    expect(JSON.parse(bob.stdout)).toMatchObject({
      task: "T2",
      session: "bob",
      action: "claimed",
    });
    await mustCli(["task", "done", run, "T2", "--session", "bob"], dir);

    const implemented = await mustCli(
      ["stage", "done", run, "implement", "--tool", "cursor", "--json"],
      dir,
    );
    expect(JSON.parse(implemented.stdout)).toMatchObject({ lifecycle: "reviewing" });
    await completeReview(dir, run, "self", "cursor", "unknown");
    await completeReview(dir, run, "cross", "codex", "gpt-5.4");
    const closed = await closeRun(dir, run);
    expect(JSON.parse(closed.stdout)).toMatchObject({ lifecycle: "closed" });
  });
});
