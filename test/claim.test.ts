import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readOwner } from "../src/core/lock.js";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

test("claim release and steal record events and honor the lock", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "claim-verbs");
    await writeTasks(run, [
      { title: "First", files: ["src/core/claim.ts"] },
      { title: "Second", deps: ["T1"], files: ["src/cli/claim.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    const early = await runCli(["claim", run, "T1", "--session", "alice"], dir);
    expect(early.code).toBe(4);
    expect(early.stderr).toContain("claim refused: run is planned");
    await startImplement(dir, run);
    const blocked = await runCli(["claim", run, "T2", "--session", "alice"], dir);
    expect(blocked.code).toBe(4);
    expect(blocked.stderr).toContain("T2.deps: claim refused: T1 is pending");
    const claimed = await runCli(["claim", run, "T1", "--session", "alice", "--json"], dir);
    expect(claimed.code).toBe(0);
    expect(JSON.parse(claimed.stdout)).toMatchObject({
      task: "T1",
      status: "in-progress",
      session: "alice",
      action: "claimed",
    });
    expect((await readOwner(run, "T1")).session).toBe("alice");
    const other = await runCli(["release", run, "T1", "--session", "bob"], dir);
    expect(other.code).toBe(5);
    expect(other.stderr).toContain("locks/T1.lock: lock held by alice");
    const released = await runCli(["release", run, "T1", "--session", "alice", "--json"], dir);
    expect(released.code).toBe(0);
    expect(JSON.parse(released.stdout)).toMatchObject({
      task: "T1",
      session: "alice",
      action: "released",
    });
    await expect(readOwner(run, "T1")).rejects.toMatchObject({ code: "not_found" });
    expect((await runCli(["claim", run, "T1", "--session", "alice"], dir)).code).toBe(0);
    const fresh = await runCli(["steal", run, "T1", "--session", "bob", "--ttl", "60"], dir);
    expect(fresh.code).toBe(5);
    const stolen = await runCli(
      ["steal", run, "T1", "--session", "bob", "--ttl", "0", "--json"],
      dir,
    );
    expect(stolen.code).toBe(0);
    expect(JSON.parse(stolen.stdout)).toMatchObject({
      task: "T1",
      session: "bob",
      action: "stolen",
    });
    expect((await readOwner(run, "T1")).session).toBe("bob");
    const forced = await runCli([
      "release",
      run,
      "T1",
      "--session",
      "alice",
      "--force",
      "--reason",
      "stale owner",
      "--json",
    ], dir);
    expect(forced.code).toBe(0);
    expect(JSON.parse(forced.stdout)).toMatchObject({
      action: "released",
      session: "alice",
      reason: "stale owner",
    });
    const noReason = await runCli(["release", run, "T1", "--session", "alice", "--force"], dir);
    expect(noReason.code).toBe(2);
    const events = await readFile(join(run, "events.jsonl"), "utf8");
    expect(events).toContain("\"action\":\"claimed\"");
    expect(events).toContain("\"action\":\"task-started\"");
    expect(events).toContain("\"action\":\"stolen\"");
    expect(events).toContain("\"action\":\"released\"");
    expect(events).toContain("\"reason\":\"stale owner\"");
  });
});
