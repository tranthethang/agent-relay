import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

test("atry review done validates the latest JSON and records head and size", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-done");
    await reachReview(run, dir);
    const created = await runCli(["review", "new", run, "self", "--tool", "cursor", "--json"], dir);
    expect(created.code).toBe(0);
    await writeFile(
      join(run, "30-self-review", "01.json"),
      `${
        JSON.stringify({
          schema: 1,
          kind: "self",
          tool: "codex",
          model: "gpt-5.4",
          fixed: 1,
          tests: "pass",
          open: [],
        })
      }\n`,
    );
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    const done = await runCli(["review", "done", run, "self", "--json"], dir);
    expect(done.code).toBe(0);
    const body = JSON.parse(done.stdout) as {
      review: string;
      head: string;
      size: { files: number };
      lifecycle: string;
    };
    expect(body.review).toBe("30-self-review/02.json");
    expect(body.lifecycle).toBe("reviewing");
    expect(body.head).toMatch(/^[0-9a-f]{40}$/);
    expect(body.size.files).toBeGreaterThanOrEqual(0);
    const events = await readFile(join(run, "events.jsonl"), "utf8");
    const completed = events.trim().split("\n").map((line) =>
      JSON.parse(line) as {
        stage?: string;
        action?: string;
        tool?: string;
        head?: string;
        size?: { files: number };
        ref?: string;
      }
    ).filter((event) => event.stage === "self-review" && event.action === "completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      tool: "cursor",
      head: body.head,
      ref: "30-self-review/02.json",
    });
  });
});

test("atry close reads the completed review, not a later unfinished scaffold", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-close");
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    await writeFile(
      join(run, "30-self-review", "01.json"),
      `${
        JSON.stringify({
          schema: 1,
          kind: "self",
          tool: "cursor",
          model: "unknown",
          fixed: 0,
          tests: "pass",
          open: [{ q: "Keep it?", need: "usage data" }],
        })
      }\n`,
    );
    expect((await runCli(["review", "done", run, "self"], dir)).code).toBe(0);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    const refused = await runCli(["close", run], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("30-self-review/01.json");
  });
});

test("atry review done names the invalid field and a missing review", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-invalid");
    await reachReview(run, dir);
    const missing = await runCli(["review", "done", run, "cross"], dir);
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain("40-cross-review: review not found");
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    await writeFile(join(run, "30-self-review", "01.json"), "{}\n");
    const invalid = await runCli(["review", "done", run, "self"], dir);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("30-self-review/01.json:");
    await writeFile(
      join(run, "30-self-review", "01.json"),
      `${
        JSON.stringify({
          schema: 1,
          kind: "cross",
          tool: "cursor",
          model: "unknown",
          fixed: 0,
          tests: "not-run",
          open: [],
        })
      }\n`,
    );
    const mismatch = await runCli(["review", "done", run, "self"], dir);
    expect(mismatch.code).toBe(2);
    expect(mismatch.stderr).toContain("30-self-review/01.json:kind: kind does not match");
    const early = await createRun(dir, "review-early-done");
    const refused = await runCli(["review", "done", early, "self"], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("review refused: run is planned");
  });
});
