import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";

test("a closed or abandoned run refuses later write verbs", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "frozen-run",
      "--title",
      "Frozen",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string };
    expect((await runCli(["close", run.path, "--abandon", "done"], dir)).code).toBe(0);
    for (
      const args of [
        ["approve", run.path, "--via", "arg"],
        ["stage", "start", run.path, "plan", "--tool", "cursor"],
        ["stage", "done", run.path, "implement", "--tool", "cursor"],
        ["close", run.path],
        ["close", run.path, "--abandon", "again"],
      ]
    ) {
      const result = await runCli(args, dir);
      expect(result.code).toBe(4);
      expect(result.stderr).toContain("run is abandoned");
    }

    const other = await runCli([
      "run",
      "new",
      "--slug",
      "closed-run",
      "--title",
      "Closed",
      "--json",
    ], dir);
    const closed = JSON.parse(other.stdout) as { path: string };
    await reachReview(closed.path, dir);
    await runCli(["review", "new", closed.path, "self", "--tool", "cursor"], dir);
    await runCli(["review", "done", closed.path, "self"], dir);
    expect((await runCli(["close", closed.path, "--via", "arg"], dir)).code).toBe(0);
    const again = await runCli(["approve", closed.path, "--via", "confirm"], dir);
    expect(again.code).toBe(4);
    expect(again.stderr).toContain("run is closed");
  });
});
