import { expect, test } from "vitest";
import { readOwner } from "../src/core/lock.js";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

test("several processes claim one task and one wins", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "claim-race");
    await writeTasks(run, [{ title: "Only", files: ["src/core/claim.ts"] }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await startImplement(dir, run);
    const results = await Promise.all(
      Array.from(
        { length: 8 },
        (_, index) => runCli(["claim", run, "T1", "--session", `s${index}`], dir),
      ),
    );
    const wins = results.filter((result) => result.code === 0);
    expect(wins).toHaveLength(1);
    expect(results.filter((result) => result.code !== 0).every((result) => result.code === 5))
      .toBe(true);
    const owner = (await readOwner(run, "T1")).session;
    expect(wins[0]?.stdout).toContain(`session: ${owner}`);
  });
});
