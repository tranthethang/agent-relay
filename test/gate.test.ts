import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";

test("implement start without approval exits 4", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "needs-approval",
      "--title",
      "Gate",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string };
    const refused = await runCli(
      ["stage", "start", run.path, "implement", "--tool", "cursor"],
      dir,
    );
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("plan is not approved");
    const events = await runCli(["status", "--json", run.path], dir);
    expect(JSON.parse(events.stdout)).toMatchObject({ lifecycle: "planned", approved: false });
  });
});

test("stage and approve verbs follow the plan state diagram", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli(
      ["run", "new", "--slug", "diagram", "--title", "D", "--json"],
      dir,
    );
    const run = JSON.parse(created.stdout) as { path: string };
    const refusals: [string[], string][] = [
      [
        ["stage", "done", run.path, "implement", "--tool", "cursor"],
        "implement done refused: run is planned",
      ],
      [
        ["stage", "start", run.path, "self-review", "--tool", "cursor"],
        "review refused: run is planned",
      ],
    ];
    for (const [args, message] of refusals) {
      const result = await runCli(args, dir);
      expect(result.code).toBe(4);
      expect(result.stderr).toContain(message);
    }
    await runCli(["approve", run.path, "--via", "arg"], dir);
    const twice = await runCli(["approve", run.path, "--via", "arg"], dir);
    expect(twice.code).toBe(4);
    expect(twice.stderr).toContain("approve refused: run is approved");
    await runCli(["stage", "start", run.path, "implement", "--tool", "cursor"], dir);
    const early = await runCli(
      ["stage", "start", run.path, "cross-review", "--tool", "codex"],
      dir,
    );
    expect(early.code).toBe(4);
    expect(early.stderr).toContain("review refused: run is implementing");
    await runCli(["stage", "done", run.path, "implement", "--tool", "cursor"], dir);
    const again = await runCli(["stage", "start", run.path, "implement", "--tool", "cursor"], dir);
    expect(again.code).toBe(4);
    expect(again.stderr).toContain("implement start refused: run is reviewing");
    const review = await runCli(
      ["stage", "start", run.path, "cross-review", "--tool", "codex"],
      dir,
    );
    expect(review.code).toBe(0);
  });
});
