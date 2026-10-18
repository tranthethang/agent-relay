import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";

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
    expect(refused.stderr).toContain("40-cross-review/01.json");
    const acked = await runCli([
      "close",
      "--ack-open",
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
    expect(stale.stderr).toContain("40-cross-review/01.json");
    await runCli(["stage", "done", run.path, "self-review", "--tool", "cursor"], dir);
    const closed = await runCli(["close", run.path], dir);
    expect(closed.code).toBe(0);
  });
});
