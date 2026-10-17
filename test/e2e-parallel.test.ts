import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { mustCli } from "./e2e.js";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

test("two sessions claim, refuse an overlap, and release", async () => {
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
    const bob = await mustCli(["claim", run, "T2", "--session", "bob", "--json"], dir);
    expect(JSON.parse(bob.stdout)).toMatchObject({
      task: "T2",
      session: "bob",
      action: "claimed",
    });
  });
});
