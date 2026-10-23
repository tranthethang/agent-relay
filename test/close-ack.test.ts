import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

test("a soft close refuses warnings until --ack-warnings and keeps them", async () => {
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
    const created = await runCli(
      ["run", "new", "--slug", "ack-close", "--title", "Ack close", "--json"],
      dir,
    );
    const run = JSON.parse(created.stdout) as { path: string };
    await reachReview(run.path, dir);
    await runCli(["review", "new", run.path, "self", "--tool", "cursor"], dir);
    await runCli(["review", "done", run.path, "self"], dir);

    const preview = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(preview.code).toBe(0);
    expect(JSON.parse(preview.stdout)).toEqual({
      schema: 1,
      recommend: "n",
      reasons: ["missing cross review"],
    });

    const refused = await runCli(["close", run.path, "--via", "confirm"], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toBe(
      "ack-warnings: soft close has warnings: missing cross review; "
        + "pass --ack-warnings to accept them\n",
    );

    const closed = await runCli(
      ["close", run.path, "--via", "confirm", "--ack-warnings", "--json"],
      dir,
    );
    expect(closed.code).toBe(0);
    expect(JSON.parse(closed.stdout)).toMatchObject({ lifecycle: "closed" });
    const events = (await readFile(join(run.path, "events.jsonl"), "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as { action: string; reason?: string; via?: string });
    expect(events.at(-1)).toMatchObject({
      action: "closed",
      via: "confirm",
      reason: "non-strict review-integrity warnings: missing cross review",
    });
  });
});

test("a soft close needs --ack-open for an open question even with --ack-warnings", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 0,
        strict: { reviewIntegrity: false },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir, "non-strict policy");
    const created = await runCli(
      ["run", "new", "--slug", "soft-open", "--title", "Soft open", "--json"],
      dir,
    );
    const run = JSON.parse(created.stdout) as { path: string };
    await reachReview(run.path, dir);
    const started = await runCli(
      ["review", "new", run.path, "self", "--tool", "cursor", "--json"],
      dir,
    );
    const reviewPaths = JSON.parse(started.stdout) as { markdown: string; json: string };
    await writeFile(
      reviewPaths.markdown,
      "# self\n\n## Findings\n\n- Q1: Continue?\n  - a. Stop\n  - b. Close anyway\n",
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
          open: [{ q: "Continue?", a: "Stop", b: "Close anyway" }],
        })
      }\n`,
    );
    expect((await runCli(["review", "done", run.path, "self"], dir)).code).toBe(0);

    const unopened = await runCli(
      ["close", run.path, "--via", "confirm", "--ack-warnings"],
      dir,
    );
    expect(unopened.code).toBe(4);
    expect(unopened.stderr).toBe("open: latest review has open questions\n");

    const closed = await runCli(["close", run.path, "--via", "confirm", "--ack-open"], dir);
    expect(closed.code).toBe(0);
    const events = (await readFile(join(run.path, "events.jsonl"), "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as { action: string; reason?: string });
    const last = events.at(-1);
    expect(last).toMatchObject({ action: "closed" });
    expect(last?.reason).toBeUndefined();
  });
});

test("a strict close accepts changes during the latest review with --ack-fixes", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 0,
        strict: { reviewIntegrity: true },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir, "strict policy");
    const created = await runCli(
      ["run", "new", "--slug", "strict-fixes", "--title", "Strict fixes", "--json"],
      dir,
    );
    const run = JSON.parse(created.stdout) as { path: string };
    await reachReview(run.path, dir);
    await runCli(["review", "new", run.path, "self", "--tool", "cursor"], dir);
    await writeFile(join(dir, "fix.txt"), "changed during review\n");
    expect((await runCli(["review", "done", run.path, "self"], dir)).code).toBe(0);

    const preview = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(JSON.parse(preview.stdout).reasons).toEqual(["changes made during the latest review"]);
    const refused = await runCli(["close", run.path], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toBe("review.delta: latest review has unacknowledged fixes\n");
    const acked = await runCli(["close", run.path, "--ack-fixes", "--json"], dir);
    expect(acked.code).toBe(0);
    expect(JSON.parse(acked.stdout)).toMatchObject({ lifecycle: "closed" });
  });
});

test("strict review integrity refuses even with --ack-warnings", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 0,
        strict: { reviewIntegrity: true },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir, "strict policy");
    const created = await runCli(
      ["run", "new", "--slug", "strict-ack", "--title", "Strict ack", "--json"],
      dir,
    );
    const run = JSON.parse(created.stdout) as { path: string };
    await reachReview(run.path, dir);

    const refused = await runCli(
      ["close", run.path, "--via", "confirm", "--ack-warnings"],
      dir,
    );
    expect(refused.code).toBe(4);
    expect(refused.stderr).toBe("self-review: required self review is missing\n");
  });
});
