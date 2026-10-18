import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

test("parallel review new calls get distinct labels", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-lock");
    await reachReview(run, dir);
    const results = await Promise.all([
      runCli(["review", "new", run, "self", "--tool", "cursor"], dir),
      runCli(["review", "new", run, "self", "--tool", "codex"], dir),
    ]);
    expect(results.every((result) => result.code === 0)).toBe(true);
    expect(results.map((result) => result.stdout).join("\n")).toContain("01.md");
    expect(results.map((result) => result.stdout).join("\n")).toContain("02.md");
    const events = (await readFile(`${run}/events.jsonl`, "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { action: string; stage: string });
    expect(events.filter((event) => event.action === "started" && event.stage === "self-review"))
      .toHaveLength(2);
  });
});

test("parallel close calls record one closed event", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "close-lock");
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    await runCli(["review", "done", run, "self"], dir);
    const results = await Promise.all([
      runCli(["close", run], dir),
      runCli(["close", run], dir),
    ]);
    expect(results.filter((result) => result.code === 0)).toHaveLength(1);
    const events = (await readFile(`${run}/events.jsonl`, "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { action: string });
    expect(events.filter((event) => event.action === "closed")).toHaveLength(1);
  });
});
