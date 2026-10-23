import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

const review = {
  schema: 1,
  kind: "cross",
  tool: "cursor",
  model: "unknown",
  fixed: 0,
  open: [{ q: "Which gate?", a: "Keep exit 4", b: "Warn only" }],
};

test("atry close gates on open questions and abandon skips the gate", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "close-run",
      "--title",
      "Close",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string };
    const early = await runCli(["close", run.path, "--via", "arg"], dir);
    expect(early.code).toBe(4);
    expect(early.stderr).toContain("close refused: run is planned");
    await reachReview(run.path, dir);
    await runCli(["review", "new", run.path, "self", "--tool", "cursor"], dir);
    await runCli(["review", "done", run.path, "self"], dir);
    const plain = await runCli(["close", run.path, "--via", "arg", "--json"], dir);
    expect(plain.code).toBe(0);
    expect(JSON.parse(plain.stdout)).toMatchObject({ lifecycle: "closed" });
    const events = (await readFile(join(run.path, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { action?: string; actor?: string });
    expect(["agent-env", "unknown"]).toContain(
      events.find((event) => event.action === "closed")?.actor,
    );

    const second = await runCli([
      "run",
      "new",
      "--slug",
      "open-review",
      "--title",
      "Open",
      "--json",
    ], dir);
    const openRun = JSON.parse(second.stdout) as { path: string };
    await reachReview(openRun.path, dir);
    await mkdir(join(openRun.path, "30-self-review"), { recursive: true });
    await mkdir(join(openRun.path, "40-cross-review"), { recursive: true });
    await writeFile(
      join(openRun.path, "30-self-review", "01.json"),
      `${JSON.stringify({ ...review, kind: "self", open: [] })}\n`,
    );
    await writeFile(
      join(openRun.path, "40-cross-review", "01.json"),
      `${JSON.stringify(review)}\n`,
    );
    const refused = await runCli(["close", openRun.path], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toBe("open: latest review has open questions\n");
    const acked = await runCli([
      "close",
      "--ack-open",
      "--ack-warnings",
      "--waive-review",
      "legacy review data",
      "--via",
      "confirm",
      openRun.path,
    ], dir);
    expect(acked.code).toBe(0);
    expect(acked.stdout).toBe("lifecycle: closed\n");
    const waiverEvents = (await readFile(join(openRun.path, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { action: string; reason?: string });
    expect(waiverEvents.find((event) => event.action === "waived")).toMatchObject({
      reason: "legacy review data",
    });

    const third = await runCli([
      "run",
      "new",
      "--slug",
      "abandon-run",
      "--title",
      "Stop",
      "--json",
    ], dir);
    const abandoned = JSON.parse(third.stdout) as { path: string };
    await writeFile(
      join(abandoned.path, "40-cross-review", "02.json"),
      `${JSON.stringify(review)}\n`,
    );
    const stopped = await runCli(
      ["close", abandoned.path, "--abandon", "stop work", "--json"],
      dir,
    );
    expect(stopped.code).toBe(0);
    expect(JSON.parse(stopped.stdout)).toMatchObject({ lifecycle: "abandoned" });
    const lines = (await readFile(join(abandoned.path, "events.jsonl"), "utf8")).trim().split("\n");
    expect(JSON.parse(lines[lines.length - 1] ?? "")).toMatchObject({
      action: "abandoned",
      reason: "stop work",
    });
  });
});

test("atry close reads the review whose completed event is newest", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli(
      ["run", "new", "--slug", "order", "--title", "Order", "--json"],
      dir,
    );
    const run = JSON.parse(created.stdout) as { path: string };
    await reachReview(run.path, dir);
    await writeFile(join(run.path, "40-cross-review", "01.json"), `${JSON.stringify(review)}\n`);
    await runCli(["stage", "done", run.path, "cross-review", "--tool", "codex"], dir);
    await writeFile(
      join(run.path, "30-self-review", "02.json"),
      `${JSON.stringify({ ...review, kind: "self", open: [] })}\n`,
    );
    const stale = await runCli(["close", run.path], dir);
    expect(stale.code).toBe(4);
    expect(stale.stderr).toBe("open: latest review has open questions\n");
    await runCli(["stage", "done", run.path, "self-review", "--tool", "cursor"], dir);
    const closed = await runCli(["close", run.path], dir);
    expect(closed.code).toBe(0);
  });
});

test("close --preview recommends n for a missing review and y after self-review", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "preview-close",
      "--title",
      "Preview",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string };
    const early = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(early.code).toBe(0);
    expect(JSON.parse(early.stdout)).toMatchObject({
      recommend: "n",
      reasons: ["missing self review"],
    });
    const earlyText = await runCli(["close", run.path, "--preview"], dir);
    expect(earlyText.stdout).toBe("recommend: n\nmissing self review\n");

    await reachReview(run.path, dir);
    await runCli(["review", "new", run.path, "self", "--tool", "cursor"], dir);
    await runCli(["review", "done", run.path, "self"], dir);
    const before = await readFile(join(run.path, "events.jsonl"), "utf8");
    const ready = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(ready.code).toBe(0);
    expect(JSON.parse(ready.stdout)).toEqual({ schema: 1, recommend: "y", reasons: [] });
    expect((await runCli(["close", run.path, "--preview"], dir)).stdout).toBe("recommend: y\n");
    expect(await readFile(join(run.path, "events.jsonl"), "utf8")).toBe(before);
  });
});

test("close --preview names open items, delta, a tree mismatch, and failed tests", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 0,
        testCommand: "node -e \"process.exit(1)\"",
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir, "policy");
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "preview-reasons",
      "--title",
      "Reasons",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string };
    await reachReview(run.path, dir);
    await mkdir(join(run.path, "30-self-review"), { recursive: true });
    await writeFile(
      join(run.path, "30-self-review", "01.json"),
      `${JSON.stringify({ ...review, kind: "self" })}\n`,
    );
    const open = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(open.code).toBe(0);
    expect(JSON.parse(open.stdout).reasons).toContain("open items");

    const second = await runCli([
      "run",
      "new",
      "--slug",
      "preview-gates",
      "--title",
      "Gates",
      "--json",
    ], dir);
    const gated = JSON.parse(second.stdout) as { path: string };
    await reachReview(gated.path, dir);
    await runCli(
      ["review", "new", gated.path, "self", "--tool", "cursor", "--model", "unknown"],
      dir,
    );
    await writeFile(join(dir, "note.txt"), "changed\n");
    await execFileAsync("git", ["add", "note.txt"], { cwd: dir });
    await gitCommit(dir, "note");
    const done = await runCli(["review", "done", gated.path, "self", "--run-tests"], dir);
    expect(done.code).toBe(0);
    await writeFile(join(dir, "later.txt"), "after\n");
    const preview = await runCli(["close", gated.path, "--preview", "--json"], dir);
    expect(preview.code).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      recommend: "n",
      reasons: ["tree mismatch", "changes made during the latest review", "failed tests"],
    });
  });
});

test("non-strict close lets the developer continue and records integrity warnings", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self", "cross"],
        smallChange: 0,
        strict: { reviewIntegrity: false },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir, "non-strict policy");
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "non-strict-close",
      "--title",
      "Non-strict close",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string };
    await reachReview(run.path, dir);
    const started = await runCli(
      ["review", "new", run.path, "self", "--tool", "cursor", "--json"],
      dir,
    );
    const reviewPaths = JSON.parse(started.stdout) as { markdown: string; json: string };
    await writeFile(
      reviewPaths.markdown,
      "# self\n\n## Findings\n\n- Q1: Continue without cross review?\n  - a. Stop\n  - b. Close anyway\n",
    );
    await writeFile(
      reviewPaths.json,
      `${
        JSON.stringify({
          schema: 1,
          kind: "self",
          tool: "cursor",
          model: "unknown",
          fixed: 0,
          open: [{ q: "Continue without cross review?", a: "Stop", b: "Close anyway" }],
        })
      }\n`,
    );
    expect((await runCli(["review", "done", run.path, "self"], dir)).code).toBe(0);

    const preview = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      recommend: "n",
      reasons: ["missing cross review", "open items"],
    });
    const unconfirmed = await runCli(["close", run.path], dir);
    expect(unconfirmed.code).toBe(4);
    const unacked = await runCli(["close", run.path, "--via", "arg"], dir);
    expect(unacked.code).toBe(4);
    expect(unacked.stderr).toBe("open: latest review has open questions\n");
    const unopened = await runCli(
      ["close", run.path, "--via", "arg", "--ack-warnings"],
      dir,
    );
    expect(unopened.code).toBe(4);
    expect(unopened.stderr).toBe("open: latest review has open questions\n");
    const closed = await runCli(
      ["close", run.path, "--via", "arg", "--ack-open", "--ack-warnings", "--json"],
      dir,
    );
    expect(closed.code).toBe(0);
    const events = (await readFile(join(run.path, "events.jsonl"), "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as { action: string; reason?: string; via?: string });
    expect(events.find((event) => event.action === "closed")).toMatchObject({
      via: "arg",
      reason: "non-strict review-integrity warnings: missing cross review",
    });
  });
});

test("strict review integrity still blocks close when reviews are missing", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self", "cross"],
        smallChange: 0,
        strict: { reviewIntegrity: true },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir, "strict policy");
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "strict-close",
      "--title",
      "Strict close",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string };
    await reachReview(run.path, dir);
    const blocked = await runCli(["close", run.path, "--via", "arg"], dir);
    expect(blocked.code).toBe(4);
    expect(blocked.stderr).toContain("required self review is missing");
  });
});

test("close --preview names run.json drift after the cache is rebuilt", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli(
      ["run", "new", "--slug", "preview-drift", "--title", "Drift", "--json"],
      dir,
    );
    const run = JSON.parse(created.stdout) as { path: string };
    await reachReview(run.path, dir);
    await runCli(["review", "new", run.path, "self", "--tool", "cursor"], dir);
    await runCli(["review", "done", run.path, "self"], dir);
    const cachePath = join(run.path, "run.json");
    const cache = JSON.parse(await readFile(cachePath, "utf8")) as { state: { approved: boolean } };
    cache.state.approved = false;
    await writeFile(cachePath, `${JSON.stringify(cache)}\n`);
    const first = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(first.stderr).toContain("run.json disagreed with events.jsonl; rebuilt");
    expect(JSON.parse(first.stdout)).toEqual({
      schema: 1,
      recommend: "n",
      reasons: ["run.json drifted 1 times"],
    });
    const second = await runCli(["close", run.path, "--preview"], dir);
    expect(second.stderr).toBe("");
    expect(second.stdout).toBe("recommend: n\nrun.json drifted 1 times\n");
  });
});

async function crossReviewWithDelta(dir: string, runPath: string): Promise<void> {
  await reachReview(runPath, dir);
  await runCli(["review", "new", runPath, "self", "--tool", "cursor"], dir);
  expect((await runCli(["review", "done", runPath, "self"], dir)).code).toBe(0);
  await runCli(["review", "new", runPath, "cross", "--tool", "codex", "--model", "gpt-5.4"], dir);
  await writeFile(join(dir, "fix.txt"), "fixed after review started\n");
  expect((await runCli(["review", "done", runPath, "cross"], dir)).code).toBe(0);
}

test("strict close refuses a cross-review delta until a later self-review", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self", "cross"],
        smallChange: 0,
        strict: { reviewIntegrity: true },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir, "policy");
    const created = await runCli(
      ["run", "new", "--slug", "delta-self", "--title", "Delta", "--json"],
      dir,
    );
    const run = JSON.parse(created.stdout) as { path: string };
    await crossReviewWithDelta(dir, run.path);

    const next = JSON.parse((await runCli(["next", run.path, "--json"], dir)).stdout) as {
      recommendation: string;
      actions: { command: string }[];
    };
    expect(next.recommendation).toMatch(/^atry review new \S+ self$/);
    expect(next.actions.map((action) => action.command)).toEqual([
      next.recommendation,
      expect.stringContaining("--preview"),
    ]);

    const refused = await runCli(["close", run.path, "--ack-fixes"], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("no later self-review");

    await runCli(["review", "new", run.path, "self", "--tool", "cursor"], dir);
    expect((await runCli(["review", "done", run.path, "self"], dir)).code).toBe(0);
    const closed = await runCli(["close", run.path, "--json"], dir);
    expect(closed.code).toBe(0);
    expect(JSON.parse(closed.stdout)).toMatchObject({ lifecycle: "closed" });
  });
});

test("a cross-review delta needs a self-review before close", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli(
      ["run", "new", "--slug", "delta-soft", "--title", "Delta soft", "--json"],
      dir,
    );
    const run = JSON.parse(created.stdout) as { path: string };
    await crossReviewWithDelta(dir, run.path);

    const next = JSON.parse((await runCli(["next", run.path, "--json"], dir)).stdout) as {
      recommendation: string;
    };
    expect(next.recommendation).toMatch(/^atry review new \S+ self$/);

    const preview = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(JSON.parse(preview.stdout)).toEqual({
      schema: 1,
      recommend: "n",
      reasons: [
        "changes made during the latest review",
        "cross-review changes have no later self-review",
      ],
    });
    const refused = "review.self: cross-review changed code and no later self-review covers it\n";
    const unacked = await runCli(["close", run.path, "--via", "arg"], dir);
    expect(unacked.code).toBe(4);
    expect(unacked.stderr).toBe(refused);
    const acked = await runCli(
      ["close", run.path, "--via", "arg", "--ack-warnings"],
      dir,
    );
    expect(acked.code).toBe(4);
    expect(acked.stderr).toBe(refused);

    await runCli(["review", "new", run.path, "self", "--tool", "cursor"], dir);
    expect((await runCli(["review", "done", run.path, "self"], dir)).code).toBe(0);
    const after = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(JSON.parse(after.stdout)).toEqual({ schema: 1, recommend: "y", reasons: [] });
    const closed = await runCli(
      ["close", run.path, "--via", "arg", "--ack-warnings", "--json"],
      dir,
    );
    expect(closed.code).toBe(0);
    expect(JSON.parse(closed.stdout)).toMatchObject({ lifecycle: "closed" });
  });
});
