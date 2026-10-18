import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { reviewMarkdown } from "../src/core/review.js";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

test("atry review new writes the next pair and a full JSON scaffold", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-new");
    await reachReview(run, dir);
    const created = await runCli(
      ["review", "new", run, "self", "--tool", "cursor", "--model", "composer", "--json"],
      dir,
    );
    expect(created.code).toBe(0);
    const body = JSON.parse(created.stdout) as {
      markdown: string;
      json: string;
      stage: string;
      action: string;
      lifecycle: string;
    };
    expect(body).toMatchObject({
      stage: "self-review",
      action: "started",
      lifecycle: "reviewing",
    });
    expect(await readFile(body.markdown, "utf8")).toBe(reviewMarkdown("self"));
    expect(JSON.parse(await readFile(body.json, "utf8"))).toEqual({
      schema: 1,
      kind: "self",
      tool: "cursor",
      model: "composer",
      fixed: 0,
      open: [],
    });
    const second = await runCli(["review", "new", run, "self", "--tool", "codex"], dir);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("02.md");
    expect(second.stdout).toContain("02.json");
    const secondJson = second.stdout.trim().split("\n")[1];
    expect(secondJson).toBeDefined();
    expect(JSON.parse(await readFile(secondJson ?? "", "utf8"))).toMatchObject({
      model: "unknown",
      tool: "codex",
    });
    const events = await readFile(`${run}/events.jsonl`, "utf8");
    expect(events).toContain("\"stage\":\"self-review\"");
    expect(events).toContain("\"action\":\"started\"");
  });
});

test("atry review new refuses before the run is reviewing", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-early");
    const refused = await runCli(["review", "new", run, "cross", "--tool", "cursor"], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("review refused: run is planned");
    const bad = await runCli(["review", "new", run, "other", "--tool", "cursor"], dir);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("kind: invalid kind");
  });
});

test("atry review new rejects an empty model and an unknown tool", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-tool");
    await reachReview(run, dir);
    const empty = await runCli(
      ["review", "new", run, "self", "--tool", "cursor", "--model", " "],
      dir,
    );
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain("model: model is empty");
    const tool = await runCli(["review", "new", run, "self", "--tool", "claude"], dir);
    expect(tool.code).toBe(2);
    expect(tool.stderr).toContain("tool: invalid tool");
  });
});

test("atry review new requires a model for cross review but defaults self to unknown", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-model-required");
    await reachReview(run, dir);
    const cross = await runCli(["review", "new", run, "cross", "--tool", "cursor"], dir);
    expect(cross.code).toBe(1);
    expect(cross.stderr).toContain("model: cross review requires --model");
    const self = await runCli(["review", "new", run, "self", "--tool", "cursor", "--json"], dir);
    expect(self.code).toBe(0);
    expect(JSON.parse(self.stdout).json).toContain("01.json");
    const jsonPath = JSON.parse(self.stdout).json as string;
    expect(JSON.parse(await readFile(jsonPath, "utf8")).model).toBe("unknown");
  });
});
