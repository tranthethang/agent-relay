import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo, writeReadyPlan } from "./helper.js";

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

test("close requires policy reviews and matching review trees", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self", "cross"],
        smallChange: 0,
      }),
    );
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => {
      execFile("git", ["add", ".agent-relay.json"], { cwd: dir }, (error) => {
        if (error !== null) reject(error);
        else resolve();
      });
    });
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "review-integrity",
      "--title",
      "Review integrity",
      "--json",
    ], dir);
    const run = (JSON.parse(created.stdout) as { path: string }).path;
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    expect((await runCli(["review", "done", run, "self"], dir)).code).toBe(0);
    const status = await runCli(["status", run, "--json"], dir);
    expect(JSON.parse(status.stdout)).toMatchObject({
      next: expect.stringContaining(" cross"),
      reviews: {
        required: ["self", "cross"],
        done: ["self"],
      },
    });
    const missing = await runCli(["close", run], dir);
    expect(missing.code).toBe(4);
    expect(missing.stderr).toContain("required cross review is missing");

    await runCli(["review", "new", run, "cross", "--tool", "codex", "--model", "gpt-5.4"], dir);
    await writeFile(join(dir, "during-review.txt"), "edited after review started\n");
    expect((await runCli(["review", "done", run, "cross"], dir)).code).toBe(0);
    const delta = await runCli(["close", run], dir);
    expect(delta.code).toBe(4);
    expect(delta.stderr).toContain("no later self-review");
    const unreviewed = await runCli(["close", run, "--ack-fixes"], dir);
    expect(unreviewed.code).toBe(4);
    expect(unreviewed.stderr).toContain("no later self-review");
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    expect((await runCli(["review", "done", run, "self"], dir)).code).toBe(0);
    const closed = await runCli(["close", run, "--ack-fixes"], dir);
    expect(closed.code).toBe(0);
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
    await writeReadyPlan(run.path);
    await runCli(["approve", run.path, "--via", "arg"], dir);
    const twice = await runCli(["approve", run.path, "--via", "arg"], dir);
    expect(twice.code).toBe(4);
    expect(twice.stderr).toContain("approve refused: run is approved");
    await runCli(["stage", "start", run.path, "implement", "--tool", "cursor"], dir);
    await mkdir(join(run.path, "10-plan"), { recursive: true });
    await writeFile(
      join(run.path, "10-plan", "index.json"),
      `${JSON.stringify({ schema: 1, tasks: [] })}\n`,
    );
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
