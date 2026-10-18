import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

async function createCompletedReview(dir: string, slug: string): Promise<string> {
  await gitCommit(dir);
  const run = await createRun(dir, slug);
  await reachReview(run, dir);
  await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
  await writeFile(
    join(run, "30-self-review", "01.md"),
    "# self\n\n- Q1: Choose?\n  - a. Small\n  - b. Durable\n- Q2: Need data?\n  - Need: sample\n",
  );
  await writeFile(
    join(run, "30-self-review", "01.json"),
    `${
      JSON.stringify({
        schema: 1,
        kind: "self",
        tool: "cursor",
        model: "unknown",
        fixed: 0,
        open: [
          { q: "Choose?", a: "Small", b: "Durable" },
          { q: "Need data?", need: "sample" },
        ],
      })
    }\n`,
  );
  const done = await runCli(["review", "done", run, "self"], dir);
  if (done.code !== 0) throw new Error(done.stderr);
  return run;
}

test("atry review decide records choice and need answers against the completed review", async () => {
  await withTempGitRepo(async (dir) => {
    const run = await createCompletedReview(dir, "decide-answers");
    const choice = await runCli(["review", "decide", run, "Q1", "a", "--json"], dir);
    expect(choice.code).toBe(0);
    const need = await runCli(["review", "decide", run, "Q2", "a", "--json"], dir);
    expect(need.code).toBe(0);
    const bad = await runCli(["review", "decide", run, "Q3", "a"], dir);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("question id is outside the open list");
    const events = (await readFile(join(run, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) =>
        JSON.parse(line) as {
          action?: string;
          answer?: string;
          question?: string;
          ref?: string;
        }
      ).filter((event) => event.action === "decided");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      answer: "a",
      question: "Choose?",
      ref: "30-self-review/01.json",
    });
    expect(events[1]?.answer).toBe("a");
  });
});

test("review done refuses a dropped question without a decision", async () => {
  await withTempGitRepo(async (dir) => {
    const run = await createCompletedReview(dir, "decide-dropped");
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    await writeFile(join(run, "30-self-review", "02.md"), "# self\n\n");
    await writeFile(
      join(run, "30-self-review", "02.json"),
      `${
        JSON.stringify({
          schema: 1,
          kind: "self",
          tool: "cursor",
          model: "unknown",
          fixed: 0,
          open: [],
        })
      }\n`,
    );
    const done = await runCli(["review", "done", run, "self"], dir);
    expect(done.code).toBe(2);
    expect(done.stderr).toContain("open question was dropped without a decision: Choose?");
  });
});

test("close accepts open items with recorded decisions", async () => {
  await withTempGitRepo(async (dir) => {
    const run = await createCompletedReview(dir, "decide-close");
    await runCli(["review", "decide", run, "Q1", "b"], dir);
    await runCli(["review", "decide", run, "Q2", "Use the sample"], dir);
    const closed = await runCli(["close", run], dir);
    expect(closed.code).toBe(0);
    expect(closed.stdout).toContain("closed");
  });
});
