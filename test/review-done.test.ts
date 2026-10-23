import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { cliPath, gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

const execFileAsync = promisify(execFile);

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
        tree?: string;
        size?: { files: number };
        delta?: { files: number; added: number; deleted: number };
        ref?: string;
      }
    ).filter((event) => event.stage === "self-review" && event.action === "completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      tool: "cursor",
      head: body.head,
      tree: expect.stringMatching(/^[0-9a-f]{40}$/),
      ref: "30-self-review/02.json",
    });
    expect(completed[0]).not.toHaveProperty("delta");
  });
});

test("atry review done runs the base policy command and writes its output tail", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 100,
        testCommand: `node -e "for(let i=1;i<=205;i++) console.log(i)"`,
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir);
    const run = await createRun(dir, "review-test-command");
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    const done = await runCli(["review", "done", run, "self", "--run-tests"], dir);
    expect(done.code).toBe(0);
    expect(done.stderr).toContain("test command: node -e");
    const events = (await readFile(join(run, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) =>
        JSON.parse(line) as {
          action?: string;
          stage?: string;
          tests?: { exit: number; ms: number; tree: string } | string;
        }
      );
    const completed = events.find((event) =>
      event.action === "completed" && event.stage === "self-review"
    );
    expect(completed?.tests).toMatchObject({
      exit: 0,
      tree: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    const log = await readFile(join(run, "30-self-review", "01.test.log"), "utf8");
    expect(log).toContain("stdout (last 200 lines):");
    expect(log).toContain("6\n7\n8\n");
    expect(log).toContain("204\n205");
    expect(log).not.toContain("\n5\n");
  });
});

test("atry review done refuses a policy test command without --run-tests", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 100,
        testCommand: `node -e "process.exit(1)"`,
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir);
    const run = await createRun(dir, "review-test-consent");
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    const refused = await runCli(["review", "done", run, "self"], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toBe(
      "run-tests: test command: node -e \"process.exit(1)\"; pass --run-tests to run it\n",
    );
    const completed = (await readFile(join(run, "events.jsonl"), "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as { stage?: string; action?: string })
      .some((event) => event.stage === "self-review" && event.action === "completed");
    expect(completed).toBe(false);

    const passed = await runCli(["review", "done", run, "self", "--run-tests"], dir);
    expect(passed.code).toBe(0);
    expect(passed.stderr).toBe("test command: node -e \"process.exit(1)\"\n");
  });
});

test("atry review done runs the policy command at the repo root", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 100,
        testCommand: `node -e "process.stdout.write(process.cwd())"`,
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir);
    const run = await createRun(dir, "review-test-cwd");
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    expect((await runCli(["review", "done", run, "self", "--run-tests"], dir)).code).toBe(0);
    const log = await readFile(join(run, "30-self-review", "01.test.log"), "utf8");
    expect(log).toContain(`stdout (last 200 lines):\n${dir}\n`);
  });
});

test("atry review done refuses a tool changed after review new", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-provenance-mismatch");
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor", "--model", "m1"], dir);
    await writeFile(
      join(run, "30-self-review", "01.json"),
      `${
        JSON.stringify({
          schema: 1,
          kind: "self",
          tool: "codex",
          model: "m1",
          fixed: 0,
          open: [],
        })
      }\n`,
    );
    const done = await runCli(["review", "done", run, "self"], dir);
    expect(done.code).toBe(2);
    expect(done.stderr).toContain("30-self-review/01.json:tool: tool differs from review start");
  });
});

test("atry review done requires column-zero question cards to match open items", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-question-count");
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    await writeFile(
      join(run, "30-self-review", "01.md"),
      "# self\n\n  - Q1: indented\n- Q2: column zero\n",
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
          open: [],
        })
      }\n`,
    );
    const done = await runCli(["review", "done", run, "self"], dir);
    expect(done.code).toBe(2);
    expect(done.stderr).toContain("review Markdown has 1 question cards but JSON has 0 open items");
    await writeFile(
      join(run, "30-self-review", "01.json"),
      `${
        JSON.stringify({
          schema: 1,
          kind: "self",
          tool: "cursor",
          model: "unknown",
          fixed: 0,
          open: [{ q: "Column-zero card", need: "one open item" }],
        })
      }\n`,
    );
    expect((await runCli(["review", "done", run, "self"], dir)).code).toBe(0);
  });
});

test("atry review done records edits made after review new", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-delta");
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    await writeFile(join(dir, "source.txt"), "change during review\n");
    const done = await runCli(["review", "done", run, "self"], dir);
    expect(done.code).toBe(0);
    const events = (await readFile(join(run, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) =>
        JSON.parse(line) as {
          stage?: string;
          action?: string;
          tree?: string;
          delta?: { files: number; added: number; deleted: number };
        }
      );
    const started = events.find((event) =>
      event.stage === "self-review" && event.action === "started"
    );
    const completed = events.find((event) =>
      event.stage === "self-review" && event.action === "completed"
    );
    expect(started?.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(completed?.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(completed?.tree).not.toBe(started?.tree);
    expect(completed?.delta).toEqual({ files: 1, added: 1, deleted: 0 });
  });
});

test("atry review done records a delta when a later start has no tree", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-delta-start");
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    await writeFile(join(dir, "during.txt"), "edited\n");
    expect((await runCli(["stage", "start", run, "self-review", "--tool", "cursor"], dir)).code)
      .toBe(0);
    expect((await runCli(["review", "done", run, "self"], dir)).code).toBe(0);
    const events = (await readFile(join(run, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) =>
        JSON.parse(line) as {
          stage?: string;
          action?: string;
          delta?: { files: number; added: number; deleted: number };
        }
      );
    const completed = events.find((event) =>
      event.stage === "self-review" && event.action === "completed"
    );
    expect(completed?.delta).toEqual({ files: 1, added: 1, deleted: 0 });
  });
});

test("atry close reads the completed review, not a later unfinished scaffold", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "review-close");
    await reachReview(run, dir);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    await writeFile(
      join(run, "30-self-review", "01.md"),
      "# self\n\n- Q1: Keep it?\n  - Need: usage data\n",
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
          open: [{ q: "Keep it?", need: "usage data" }],
        })
      }\n`,
    );
    expect((await runCli(["review", "done", run, "self"], dir)).code).toBe(0);
    await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
    const refused = await runCli(["close", run], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toBe("open: latest review has open questions\n");
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

test.skipIf(process.platform === "win32")(
  "atry review done passes SIGINT to the test command group",
  async () => {
    await withTempGitRepo(async (dir) => {
      await writeFile(
        join(dir, ".agent-relay.json"),
        JSON.stringify({
          schema: 1,
          requireReviews: ["self"],
          smallChange: 100,
          testCommand:
            `node -e "require('fs').writeFileSync('child.pid', String(process.pid)); setTimeout(() => {}, 30000)"; echo after`,
        }),
      );
      await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
      await gitCommit(dir);
      const run = await createRun(dir, "review-test-signal");
      await reachReview(run, dir);
      await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
      const atry = spawn(
        process.execPath,
        [cliPath, "review", "done", run, "self", "--run-tests"],
        {
          cwd: dir,
          stdio: "ignore",
        },
      );
      const exited = new Promise<NodeJS.Signals | null>((resolve) => {
        atry.on("exit", (_code, signal) => resolve(signal));
      });
      let pid: number | undefined;
      for (let attempt = 0; attempt < 100 && pid === undefined; attempt += 1) {
        await delay(50);
        pid = await readFile(join(dir, "child.pid"), "utf8").then(Number, () => undefined);
      }
      expect(pid).toBeDefined();
      atry.kill("SIGINT");
      expect(await exited).toBe("SIGINT");
      let alive = true;
      for (let attempt = 0; attempt < 40 && alive; attempt += 1) {
        await delay(50);
        try {
          process.kill(pid as number, 0);
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    });
  },
  20000,
);

async function reviewWithTestCommand(
  dir: string,
  slug: string,
  testCommand: string,
): Promise<{ run: string; done: Awaited<ReturnType<typeof runCli>> }> {
  await writeFile(
    join(dir, ".agent-relay.json"),
    JSON.stringify({ schema: 1, requireReviews: ["self"], smallChange: 100, testCommand }),
  );
  await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
  await gitCommit(dir);
  const run = await createRun(dir, slug);
  await reachReview(run, dir);
  await runCli(["review", "new", run, "self", "--tool", "cursor"], dir);
  return { run, done: await runCli(["review", "done", run, "self", "--run-tests"], dir) };
}

async function selfReviewEvents(
  run: string,
): Promise<{ action?: string; tree?: string; tests?: { exit: number; tree: string } }[]> {
  return (await readFile(join(run, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) =>
      JSON.parse(line) as {
        stage?: string;
        action?: string;
        tree?: string;
        tests?: { exit: number; tree: string };
      }
    ).filter((event) => event.stage === "self-review");
}

test("atry review done releases the run lock while the test command runs", async () => {
  await withTempGitRepo(async (dir) => {
    const { run, done } = await reviewWithTestCommand(
      dir,
      "review-test-unlocked",
      `node -e "const f=require('fs');process.exit(f.readdirSync('.agent-relay').some(d=>f.existsSync('.agent-relay/'+d+'/locks/run.lock'))?1:0)"`,
    );
    expect(done.code).toBe(0);
    const completed = (await selfReviewEvents(run)).find((event) => event.action === "completed");
    expect(completed?.tests).toMatchObject({ exit: 0 });
  });
});

test("atry review done records the tree the tests started on", async () => {
  await withTempGitRepo(async (dir) => {
    const { run, done } = await reviewWithTestCommand(
      dir,
      "review-test-tree",
      `node -e "require('fs').appendFileSync('source.txt','edited by tests')"`,
    );
    expect(done.code).toBe(0);
    const completed = (await selfReviewEvents(run)).find((event) => event.action === "completed");
    expect(completed?.tests?.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(completed?.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(completed?.tests?.tree).not.toBe(completed?.tree);
  });
});

test("atry review done refuses when the review stage changed during tests", async () => {
  await withTempGitRepo(async (dir) => {
    const { run, done } = await reviewWithTestCommand(
      dir,
      "review-test-race",
      `node "${cliPath}" review new review-test-race self --tool cursor`,
    );
    expect(done.code).not.toBe(0);
    expect(done.stderr).toContain("review stage changed while tests ran");
    expect(done.stderr).toContain("events.jsonl");
    const events = await selfReviewEvents(run);
    expect(events.filter((event) => event.action === "started")).toHaveLength(2);
    expect(events.some((event) => event.action === "completed")).toBe(false);
  });
});
