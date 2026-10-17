import { expect, test } from "vitest";
import { modelFamily } from "../src/core/review.js";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

test("model family is the prefix before the first digit", () => {
  expect(modelFamily("claude-opus-5-5")).toBe("claude-opus-");
  expect(modelFamily("unknown")).toBe("unknown");
  expect(modelFamily("5-opus")).toBe("5-opus");
});

test("atry review done warns when a cross review matches earlier tools or families", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-diversity");
    await reachReview(run, dir);
    const self = await runCli([
      "review",
      "new",
      run,
      "self",
      "--tool",
      "claude-code",
      "--model",
      "claude-opus-4",
    ], dir);
    expect(self.code).toBe(0);
    const selfDone = await runCli(["review", "done", run, "self", "--json"], dir);
    expect(selfDone.code).toBe(0);
    expect(selfDone.stderr).toBe("");
    expect(JSON.parse(selfDone.stdout)).not.toHaveProperty("warnings");
    const cross = await runCli([
      "review",
      "new",
      run,
      "cross",
      "--tool",
      "cursor",
      "--model",
      "claude-opus-5-5",
    ], dir);
    expect(cross.code).toBe(0);
    const done = await runCli(["review", "done", run, "cross", "--json"], dir);
    expect(done.code).toBe(0);
    expect(done.stderr).toContain("warning: cross tool matches implement tool");
    expect(done.stderr).toContain("warning: cross model family matches self-review model");
    expect(done.stderr).not.toContain("self-review tool");
    expect(JSON.parse(done.stdout).warnings).toEqual([
      "cross tool matches implement tool",
      "cross model family matches self-review model",
    ]);
  });
});

test("atry review done stays quiet when the cross review differs", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-diverse");
    await reachReview(run, dir);
    await runCli([
      "review",
      "new",
      run,
      "self",
      "--tool",
      "claude-code",
      "--model",
      "claude-sonnet-5-5",
    ], dir);
    await runCli(["review", "done", run, "self"], dir);
    await runCli([
      "review",
      "new",
      run,
      "cross",
      "--tool",
      "codex",
      "--model",
      "gpt-5.4",
    ], dir);
    const done = await runCli(["review", "done", run, "cross", "--json"], dir);
    expect(done.code).toBe(0);
    expect(done.stderr).toBe("");
    expect(JSON.parse(done.stdout)).not.toHaveProperty("warnings");
  });
});
