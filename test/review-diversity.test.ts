import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { modelLine, modelVendor } from "../src/core/model.js";
import { diversityWarnings } from "../src/core/review.js";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

test("model vendor and line use a shared vendor map", () => {
  expect(modelVendor("claude-opus-4")).toBe("anthropic");
  expect(modelVendor("gpt-5.4")).toBe("openai");
  expect(modelVendor("o3-mini")).toBe("openai");
  expect(modelVendor("codex-mini")).toBe("openai");
  expect(modelVendor("gemini-2.5")).toBe("google");
  expect(modelVendor("composer-1")).toBe("cursor");
  expect(modelVendor("custom-model")).toBe("unknown");
  expect(modelLine("claude-opus-5-5")).toBe("claude-opus");
  expect(modelLine("gpt-5.4")).toBe("gpt");
  expect(modelLine("custom-model")).toBe("custom-model");
});

test("an unknown vendor is not a vendor match and still checks the model line", () => {
  const review = {
    schema: 1 as const,
    kind: "cross" as const,
    tool: "codex" as const,
    model: "custom-1",
    fixed: 0,
    open: [],
  };
  expect(diversityWarnings(review, { model: "custom-2" }, undefined)).toEqual([
    "cross model vendor unknown for implement model",
    "cross model line matches implement model",
  ]);
  expect(diversityWarnings(review, { model: "other-model" }, undefined)).toEqual([
    "cross model vendor unknown for implement model",
  ]);
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
    expect(done.stderr).toContain("warning: cross model vendor matches self-review model");
    expect(done.stderr).toContain("warning: cross model line matches self-review model");
    expect(done.stderr).not.toContain("self-review tool");
    expect(JSON.parse(done.stdout).warnings).toEqual([
      "cross tool matches implement tool",
      "cross model vendor matches self-review model",
      "cross model line matches self-review model",
    ]);
  });
});

test("atry review done keeps the implement model when stage done omits it", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-implement-model");
    for (
      const args of [
        ["approve", run, "--via", "arg"],
        ["stage", "start", run, "implement", "--tool", "codex", "--model", "gpt-5.4"],
      ]
    ) {
      expect((await runCli(args, dir)).code).toBe(0);
    }
    await mkdir(join(run, "10-plan"), { recursive: true });
    await writeFile(
      join(run, "10-plan", "index.json"),
      `${JSON.stringify({ schema: 1, tasks: [] })}\n`,
    );
    for (
      const args of [
        ["stage", "done", run, "implement", "--tool", "codex"],
        ["review", "new", run, "self", "--tool", "cursor", "--model", "composer-1"],
        ["review", "done", run, "self"],
        ["review", "new", run, "cross", "--tool", "claude-code", "--model", "gpt-5.5"],
      ]
    ) {
      expect((await runCli(args, dir)).code).toBe(0);
    }
    const done = await runCli(["review", "done", run, "cross", "--json"], dir);
    expect(done.code).toBe(0);
    expect(JSON.parse(done.stdout).warnings).toEqual([
      "cross model vendor matches implement model",
      "cross model line matches implement model",
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
