import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appendChained } from "../src/core/cache.js";
import { RelayError } from "../src/core/error.js";
import { type EventLine } from "../src/core/event.js";
import * as git from "../src/core/git.js";
import {
  approvePreview,
  approveRun,
  closePreview,
  closePreviewText,
  closeRun,
  closeText,
  doneStage,
  finishBrainstorm,
  reviewIntegrity,
  sectionText,
  stageText,
  startStage,
} from "../src/core/lifecycle.js";
import * as mutate from "../src/core/mutate.js";
import { taskSkip } from "../src/core/plan.js";
import { createRun } from "../src/core/scaffold.js";
import * as tasks from "../src/core/tasks.js";
import * as worktree from "../src/core/worktree.js";
import { gitCommit, withTempDir, withTempGitRepo, writeReadyPlan } from "./helper.js";

vi.mock("../src/core/mutate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/mutate.js")>();
  return { ...actual, appendEvent: vi.fn(actual.appendEvent) };
});
vi.mock("../src/core/worktree.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/worktree.js")>();
  return {
    ...actual,
    gitCwd: vi.fn(actual.gitCwd),
    keepReason: vi.fn(actual.keepReason),
    mainRoot: vi.fn(actual.mainRoot),
    removeMergedWorktree: vi.fn(actual.removeMergedWorktree),
    validateRunWorktree: vi.fn(actual.validateRunWorktree),
  };
});
vi.mock("../src/core/tasks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/tasks.js")>();
  return { ...actual, readPlanIndex: vi.fn(actual.readPlanIndex) };
});
vi.mock("../src/core/git.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/git.js")>();
  return { ...actual, treeDiffSize: vi.fn(actual.treeDiffSize) };
});

const execFileAsync = promisify(execFile);
const savedThread = process.env.CODEX_THREAD_ID;

beforeEach(() => {
  delete process.env.CODEX_THREAD_ID;
});

afterEach(() => {
  if (savedThread === undefined) delete process.env.CODEX_THREAD_ID;
  else process.env.CODEX_THREAD_ID = savedThread;
  vi.restoreAllMocks();
  for (
    const mock of [
      mutate.appendEvent,
      worktree.gitCwd,
      worktree.keepReason,
      worktree.mainRoot,
      worktree.removeMergedWorktree,
      worktree.validateRunWorktree,
      tasks.readPlanIndex,
      git.treeDiffSize,
    ]
  ) {
    vi.mocked(mock).mockReset();
  }
});

async function newRun(dir: string, slug: string): Promise<string> {
  await gitCommit(dir);
  const created = await createRun({ cwd: dir, slug, title: slug });
  await writeReadyPlan(created.path);
  return created.path;
}

async function toReviewing(runDir: string): Promise<void> {
  await approveRun({ runDir, via: "arg" });
  await startStage({ runDir, stage: "implement", tool: "cursor" });
  await taskSkip(runDir, "T1", "review fixture");
  await doneStage({ runDir, stage: "implement", tool: "cursor" });
}

function event(fields: Partial<EventLine>): EventLine {
  return {
    schema: 1,
    ts: "2026-10-20T00:00:00.000Z",
    stage: "run",
    action: "created",
    ...fields,
  } as EventLine;
}

test("approvePreview rethrows a read error other than ENOENT", async () => {
  await withTempDir(async (runDir) => {
    await mkdir(join(runDir, "10-plan", "overview.md"), { recursive: true });
    await expect(approvePreview(runDir)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

test("finishBrainstorm names a missing file, invalid JSON, a read error, and a root schema error", async () => {
  await withTempDir(async (dir) => {
    await expect(finishBrainstorm(dir)).rejects.toMatchObject({ code: "not_found" });
    await writeFile(join(dir, "open.json"), "{");
    await expect(finishBrainstorm(dir)).rejects.toMatchObject({ fieldPath: "open.json" });
    await rm(join(dir, "open.json"));
    await mkdir(join(dir, "open.json"));
    await expect(finishBrainstorm(dir)).rejects.toMatchObject({ code: "EISDIR" });
    await rm(join(dir, "open.json"), { recursive: true });
    await writeFile(join(dir, "open.json"), "null\n");
    await expect(finishBrainstorm(dir)).rejects.toMatchObject({
      code: "validation",
      fieldPath: "open.json",
    });
  });
});

test("stage input checks reject a bad stage and an empty model", async () => {
  await expect(startStage({ runDir: "/none", stage: "nope", tool: "cursor" })).rejects.toThrow(
    /invalid stage/,
  );
  await expect(
    startStage({ runDir: "/none", stage: "plan", tool: "cursor", model: " " }),
  ).rejects.toThrow(/model is empty/);
});

test("a detected tool sets the agent-env actor and warns on a differing tool", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "detected");
    process.env.CODEX_THREAD_ID = "thread";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await approveRun({ runDir, via: "arg" });
    const started = await startStage({ runDir, stage: "implement", tool: "cursor" });
    expect(started.action).toBe("started");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("detected tool codex"));
    const events = (await readFile(join(runDir, "events.jsonl"), "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as EventLine);
    expect(events.find((line) => line.action === "approved")?.actor).toBe("agent-env");
    expect(events.find((line) => line.action === "started")?.detected).toBe("codex");
    await taskSkip(runDir, "T1", "fixture");
    await doneStage({ runDir, stage: "implement", tool: "cursor" });
    const abandoned = await closeRun({ runDir, abandon: "stop", via: "arg" });
    expect(abandoned.lifecycle).toBe("abandoned");
  });
});

test("implement done refuses an empty allow-extra reason", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "extra");
    await approveRun({ runDir, via: "arg" });
    await startStage({ runDir, stage: "implement", tool: "cursor" });
    await taskSkip(runDir, "T1", "fixture");
    await writeFile(join(dir, "stray.txt"), "x\n");
    await expect(
      doneStage({ runDir, stage: "implement", tool: "cursor", allowExtra: " " }),
    ).rejects.toThrow(/reason is empty/);
  });
});

test("implement done reads planned files: missing, unreadable, and invalid", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "planned");
    await approveRun({ runDir, via: "arg" });
    await startStage({ runDir, stage: "implement", tool: "cursor" });
    const index = join(runDir, "10-plan", "index.json");
    vi.mocked(tasks.readPlanIndex).mockResolvedValue({ schema: 1, tasks: [] });
    await rm(index);
    await mkdir(index);
    await expect(doneStage({ runDir, stage: "implement", tool: "cursor" })).rejects.toMatchObject({
      code: "EISDIR",
    });
    await rm(index, { recursive: true });
    await writeFile(index, "{\"schema\":1}\n");
    await expect(doneStage({ runDir, stage: "implement", tool: "cursor" })).rejects.toMatchObject({
      fieldPath: "10-plan/index.json",
    });
    await rm(index);
    const done = await doneStage({ runDir, stage: "implement", tool: "cursor" });
    expect(done.lifecycle).toBe("reviewing");
  });
});

test("close refuses a review tree mismatch and waives without via", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "mismatch");
    await toReviewing(runDir);
    await startStage({ runDir, stage: "self-review", tool: "cursor" });
    await doneStage({ runDir, stage: "self-review", tool: "cursor" });
    await writeFile(join(dir, "late.txt"), "late\n");
    await expect(closeRun({ runDir })).rejects.toMatchObject({ fieldPath: "review.tree" });
    process.env.CODEX_THREAD_ID = "thread";
    const closed = await closeRun({ runDir, waiveReview: "legacy" });
    expect(closed.lifecycle).toBe("closed");
  });
});

test("close reports when the appended event leaves the lifecycle unchanged", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "stuck");
    await toReviewing(runDir);
    const actual = vi.mocked(mutate.appendEvent).getMockImplementation();
    vi.mocked(mutate.appendEvent).mockImplementation(async (loaded, path, line) => {
      const saved = await actual!(loaded, path, line);
      return {
        ...saved,
        run: { ...saved.run, state: { ...saved.run.state, lifecycle: "reviewing" } },
      };
    });
    await expect(closeRun({ runDir, abandon: "stop" })).rejects.toThrow(/did not abandon/);
    const second = await newRun(dir, "stuck-close");
    vi.mocked(mutate.appendEvent).mockReset();
    await toReviewing(second);
    vi.mocked(mutate.appendEvent).mockImplementation(async (loaded, path, line) => {
      const saved = await actual!(loaded, path, line);
      return {
        ...saved,
        run: { ...saved.run, state: { ...saved.run.state, lifecycle: "reviewing" } },
      };
    });
    await expect(closeRun({ runDir: second, waiveReview: "skip", ackOpen: true })).rejects.toThrow(
      /did not close/,
    );
  });
});

test("close reports a worktree cleanup failure from an Error and from a non-Error", async () => {
  await withTempGitRepo(async (dir) => {
    for (
      const [slug, failure, text] of [
        ["wt-error", new Error("boom"), "boom"],
        ["wt-string", "plain", "plain"],
      ] as const
    ) {
      const runDir = await newRun(dir, slug);
      await toReviewing(runDir);
      const runJson = join(runDir, "run.json");
      const run = JSON.parse(await readFile(runJson, "utf8")) as Record<string, unknown>;
      await writeFile(
        runJson,
        `${JSON.stringify({ ...run, worktree: { path: dir, branch: "main" } })}\n`,
      );
      vi.mocked(worktree.mainRoot).mockRejectedValueOnce(failure);
      const closed = await closeRun({ runDir, waiveReview: "skip", ackOpen: true });
      expect(closed.worktree).toEqual({
        removed: false,
        reason: `worktree cleanup failed: ${text}`,
      });
    }
  });
});

test("reviewIntegrity rethrows a cwd error unless close removed the worktree", async () => {
  const removed = new RelayError("not_found", "worktree not found", "run.json:worktree.path");
  vi.mocked(worktree.gitCwd).mockRejectedValueOnce(removed);
  await expect(reviewIntegrity("/none", "base", [])).rejects.toBe(removed);
  const other = new Error("other");
  vi.mocked(worktree.gitCwd).mockRejectedValueOnce(other);
  await expect(reviewIntegrity("/none", "base", [event({ action: "closed" })])).rejects.toBe(other);
});

test("reviewIntegrity on a removed worktree sizes from the latest review tree", async () => {
  await withTempGitRepo(async (dir) => {
    const removed = new RelayError("not_found", "worktree not found", "run.json:worktree.path");
    await gitCommit(dir);
    const base = await git.gitHead(dir);
    const closed = event({ action: "closed" });
    vi.mocked(worktree.gitCwd).mockRejectedValue(removed);
    const noReview = await reviewIntegrity(dir, base, [closed]);
    expect(noReview).toMatchObject({ required: ["self"], done: [], treeMatch: null });
    vi.mocked(git.treeDiffSize).mockResolvedValueOnce({ files: 9, added: 90, deleted: 9 });
    const reviewed = await reviewIntegrity(dir, base, [
      event({
        stage: "cross-review",
        action: "completed",
        tree: "abc",
        delta: { files: 1, added: 1, deleted: 0 },
      }),
      closed,
    ]);
    expect(reviewed).toMatchObject({
      required: ["self", "cross"],
      done: ["cross"],
      treeMatch: null,
      delta: { files: 1, added: 1, deleted: 0 },
    });
  });
});

test("closePreview scans review folders and refuses an invalid review ref", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "scan");
    await toReviewing(runDir);
    await startStage({ runDir, stage: "self-review", tool: "cursor" });
    await doneStage({ runDir, stage: "self-review", tool: "cursor" });
    const review = { schema: 1, kind: "self", tool: "cursor", model: "unknown", findings: [] };
    const selfDir = join(runDir, "30-self-review");
    await mkdir(selfDir, { recursive: true });
    await writeFile(join(selfDir, "notes.md"), "notes\n");
    await writeFile(join(selfDir, "01.json"), `${JSON.stringify({ ...review, open: [] })}\n`);
    await writeFile(
      join(selfDir, "02.json"),
      `${JSON.stringify({ ...review, open: [{ q: "Which?", a: "A", b: "B" }] })}\n`,
    );
    await rm(join(runDir, "40-cross-review"), { recursive: true, force: true });
    const preview = await closePreview(runDir);
    expect(preview.reasons).toContain("open items");
    await writeFile(join(runDir, "40-cross-review"), "file\n");
    await expect(closePreview(runDir)).rejects.toMatchObject({ code: "ENOTDIR" });
    await rm(join(runDir, "40-cross-review"));
    await appendChained(runDir, event({ stage: "self-review", action: "completed", ref: "bad" }));
    await expect(closePreview(runDir)).rejects.toThrow(/invalid review ref/);
  });
});

async function addEvents(runDir: string, lines: Partial<EventLine>[]): Promise<void> {
  for (const line of lines) await appendChained(runDir, event(line));
}

async function setWorktree(runDir: string, path: string): Promise<void> {
  const runJson = join(runDir, "run.json");
  const run = JSON.parse(await readFile(runJson, "utf8")) as Record<string, unknown>;
  await writeFile(runJson, `${JSON.stringify({ ...run, worktree: { path, branch: "main" } })}\n`);
}

async function commitPolicy(dir: string, strict: Record<string, boolean>): Promise<void> {
  await writeFile(
    join(dir, ".agent-relay.json"),
    `${
      JSON.stringify({ schema: 1, requireReviews: ["self", "cross"], smallChange: 20, strict })
    }\n`,
  );
  await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
  await gitCommit(dir, "policy");
}

const review = { schema: 1, kind: "self", tool: "cursor", model: "unknown", findings: [] };

test("text helpers print optional lines only when present", () => {
  const base = {
    schema: 1,
    path: "/r",
    stage: "plan",
    action: "started",
    lifecycle: "planned",
  } as const;
  expect(stageText(base)).toBe("stage: plan\naction: started\nlifecycle: planned\n");
  expect(stageText({ ...base, head: "h", size: { files: 1, added: 2, deleted: 3 }, warning: "w" }))
    .toBe("stage: plan\naction: started\nlifecycle: planned\nhead: h\nsize: 1 2 3\nwarning: w\n");
  expect(closeText({ schema: 1, path: "/r", lifecycle: "closed" })).toBe("lifecycle: closed\n");
  expect(closeText({ schema: 1, path: "/r", lifecycle: "closed", worktree: { removed: true } }))
    .toContain("worktree: removed");
  expect(
    closeText({
      schema: 1,
      path: "/r",
      lifecycle: "closed",
      worktree: { removed: false, reason: "x" },
    }),
  ).toContain("worktree: kept (x)");
  expect(
    closePreviewText({
      schema: 1,
      recommend: "y",
      reasons: [],
      decision: {
        question: "Close it?",
        onYes: "atry close r --via confirm",
        onYesArg: "atry close r --via arg",
        onNo: null,
      },
    }),
  ).toBe("recommend: y\nquestion: Close it?\non yes: atry close r --via confirm\n");
  expect(
    closePreviewText({
      schema: 1,
      recommend: "n",
      reasons: ["a"],
      worktree: { remove: true },
      decision: { question: "q", onYes: null, onYesArg: null, onNo: null },
    }),
  )
    .toBe("recommend: n\na\nworktree: close will remove it\nquestion: q\non yes: none\n");
  expect(
    closePreviewText({
      schema: 1,
      recommend: "y",
      reasons: [],
      worktree: { remove: false, reason: "r" },
      decision: { question: "q", onYes: null, onYesArg: null, onNo: null },
    }),
  ).toBe("recommend: y\nworktree: close will keep it (r)\nquestion: q\non yes: none\n");
  expect(sectionText("# T\n", "Goal")).toBe("");
  expect(sectionText("## Goal\nship\n## Next\nno\n", "Goal")).toBe("ship");
});

test("approvePreview counts tasks from a missing, unreadable, invalid, and valid index", async () => {
  await withTempDir(async (runDir) => {
    expect(await approvePreview(runDir)).toEqual({
      schema: 1,
      goal: "",
      nonGoals: "",
      constraints: "",
      decisions: "",
      tasks: 0,
      taskFiles: [],
      ready: false,
      missing: ["10-plan/overview.md", "10-plan/index.json"],
      decision: {
        question: "The plan is not ready. Missing: 10-plan/overview.md; 10-plan/index.json.",
        onYes: null,
        onYesArg: null,
        onNo: null,
      },
    });
    const index = join(runDir, "10-plan", "index.json");
    await mkdir(index, { recursive: true });
    await expect(approvePreview(runDir)).rejects.toMatchObject({ code: "EISDIR" });
    await rm(index, { recursive: true });
    await writeFile(index, "{}\n");
    expect((await approvePreview(runDir)).tasks).toBe(0);
    await writeFile(
      index,
      `${
        JSON.stringify({
          schema: 1,
          tasks: [{ id: "T1", title: "One", deps: [], files: [], path: "10-plan/T1.md" }],
        })
      }\n`,
    );
    expect((await approvePreview(runDir)).tasks).toBe(1);
  });
});

test("finishBrainstorm counts open items and names a nested schema error", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "open.json"), `${JSON.stringify({ schema: 1, open: [] })}\n`);
    expect(await finishBrainstorm(dir)).toEqual({ schema: 1, path: dir, open: 0 });
    await writeFile(join(dir, "open.json"), `${JSON.stringify({ schema: 1, open: "x" })}\n`);
    await expect(finishBrainstorm(dir)).rejects.toMatchObject({ fieldPath: "open.json:open" });
  });
});

test("stage gates refuse a bad tool, bad via, unapproved start, a wrong move, and a dirty tree", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "gates");
    await expect(startStage({ runDir, stage: "plan", tool: "nope" })).rejects.toThrow(
      /invalid tool/,
    );
    await expect(approveRun({ runDir, via: "nope" })).rejects.toThrow(/invalid via/);
    await expect(startStage({ runDir, stage: "implement", tool: "cursor" })).rejects.toThrow(
      /not approved/,
    );
    await expect(startStage({ runDir, stage: "self-review", tool: "cursor" })).rejects.toThrow(
      /review refused: run is planned/,
    );
    const plan = await startStage({ runDir, stage: "plan", tool: "cursor", model: "m1" });
    expect(plan.lifecycle).toBe("planned");
    const planDone = await doneStage({ runDir, stage: "plan", tool: "cursor" });
    expect(planDone.head).toBeUndefined();
    await approveRun({ runDir, via: "arg" });
    await writeFile(join(dir, "dirty.txt"), "x\n");
    await expect(startStage({ runDir, stage: "implement", tool: "cursor" })).rejects.toThrow(
      /working tree has changes/,
    );
  });
});

test("implement done refuses a missing index and open tasks, and warns on extra edits", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "done-gates");
    await approveRun({ runDir, via: "arg" });
    await startStage({ runDir, stage: "implement", tool: "cursor" });
    const index = join(runDir, "10-plan", "index.json");
    await rm(index);
    await expect(doneStage({ runDir, stage: "implement", tool: "cursor" })).rejects.toThrow(
      /index.json not found/,
    );
    await writeFile(
      index,
      `${
        JSON.stringify({
          schema: 1,
          tasks: [{ id: "T1", title: "One", deps: [], files: ["a.txt"], path: "10-plan/T1.md" }],
        })
      }\n`,
    );
    await expect(doneStage({ runDir, stage: "implement", tool: "cursor" })).rejects.toThrow(
      /open tasks: T1/,
    );
    await writeFile(index, `${JSON.stringify({ schema: 1, tasks: [] })}\n`);
    await writeFile(join(dir, "stray.txt"), "x\n");
    const done = await doneStage({ runDir, stage: "implement", tool: "cursor" });
    expect(done.warning).toBe("accepted out-of-scope edits: stray.txt");
  });
});

test("strict scope refuses extra edits without allow-extra", async () => {
  await withTempGitRepo(async (dir) => {
    await commitPolicy(dir, { scope: true });
    const runDir = await newRun(dir, "strict-scope");
    await approveRun({ runDir, via: "arg" });
    await startStage({ runDir, stage: "implement", tool: "cursor" });
    await taskSkip(runDir, "T1", "fixture");
    await writeFile(join(dir, "stray.txt"), "x\n");
    await expect(doneStage({ runDir, stage: "implement", tool: "cursor" })).rejects.toThrow(
      /edits outside task files: stray.txt/,
    );
  });
});

test("implement start validates an existing run worktree", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "wt-start");
    await approveRun({ runDir, via: "arg" });
    await setWorktree(runDir, dir);
    vi.mocked(worktree.validateRunWorktree).mockResolvedValueOnce(undefined);
    const started = await startStage({ runDir, stage: "implement", tool: "cursor" });
    expect(started.lifecycle).toBe("implementing");
    expect(worktree.validateRunWorktree).toHaveBeenCalledOnce();
  });
});

test("close checks empty reasons, open questions, missing reviews, and fixes", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "close-gates");
    await expect(closeRun({ runDir, waiveReview: " " })).rejects.toThrow(/reason is empty/);
    await expect(closeRun({ runDir, abandon: " " })).rejects.toThrow(/reason is empty/);
    await toReviewing(runDir);
    await expect(closeRun({ runDir })).rejects.toThrow(/required self review is missing/);
    await startStage({ runDir, stage: "self-review", tool: "cursor" });
    const self = await doneStage({ runDir, stage: "self-review", tool: "cursor" });
    const selfDir = join(runDir, "30-self-review");
    await mkdir(selfDir, { recursive: true });
    await writeFile(
      join(selfDir, "01.json"),
      `${JSON.stringify({ ...review, open: [{ q: "Which?", a: "A", b: "B" }] })}\n`,
    );
    await expect(closeRun({ runDir })).rejects.toMatchObject({ code: "gate", fieldPath: "open" });
    await expect(closeRun({ runDir, via: "arg", ackWarnings: true })).rejects.toMatchObject({
      code: "gate",
      fieldPath: "open",
    });
    await rm(join(selfDir, "01.json"));
    await addEvents(runDir, [{
      stage: "self-review",
      action: "completed",
      tree: self.tree,
      delta: { files: 1, added: 1, deleted: 0 },
    }]);
    expect((await closePreview(runDir)).reasons).toEqual(["changes made during the latest review"]);
    await expect(closeRun({ runDir })).rejects.toThrow(/unacknowledged fixes/);
    const closed = await closeRun({ runDir, ackFixes: true });
    expect(closed).toEqual({ schema: 1, path: runDir, lifecycle: "closed" });
  });
});

test("a soft close accepts an open question with ackOpen and adds no warning", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "soft-open");
    await toReviewing(runDir);
    await startStage({ runDir, stage: "self-review", tool: "cursor" });
    await doneStage({ runDir, stage: "self-review", tool: "cursor" });
    await writeFile(
      join(runDir, "30-self-review", "01.json"),
      `${JSON.stringify({ ...review, open: [{ q: "Which?", a: "A", b: "B" }] })}\n`,
    );
    await expect(closeRun({ runDir, via: "confirm", ackWarnings: true })).rejects.toMatchObject({
      code: "gate",
      fieldPath: "open",
    });
    const closed = await closeRun({ runDir, via: "confirm", ackOpen: true });
    expect(closed.lifecycle).toBe("closed");
    const lines = (await readFile(join(runDir, "events.jsonl"), "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as EventLine);
    expect(lines.at(-1)).toMatchObject({ action: "closed", via: "confirm" });
    expect(lines.at(-1)?.reason).toBeUndefined();
  });
});

test("close passes integrity, waives with via, and soft-closes with warnings", async () => {
  await withTempGitRepo(async (dir) => {
    const clean = await newRun(dir, "close-clean");
    await toReviewing(clean);
    await startStage({ runDir: clean, stage: "self-review", tool: "cursor" });
    await doneStage({ runDir: clean, stage: "self-review", tool: "cursor" });
    expect((await closePreview(clean)).recommend).toBe("y");
    expect((await closeRun({ runDir: clean })).lifecycle).toBe("closed");

    const waived = await newRun(dir, "close-waived");
    await toReviewing(waived);
    expect(
      (await closeRun({ runDir: waived, waiveReview: "skip", via: "arg", ackWarnings: true }))
        .lifecycle,
    ).toBe("closed");

    const soft = await newRun(dir, "close-soft");
    await toReviewing(soft);
    expect((await closeRun({ runDir: soft, via: "confirm", ackWarnings: true })).lifecycle).toBe(
      "closed",
    );
    const lines = (await readFile(join(soft, "events.jsonl"), "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as EventLine);
    expect(lines.at(-1)).toMatchObject({
      action: "closed",
      via: "confirm",
      reason: "non-strict review-integrity warnings: missing self review",
    });
  });
});

test("strict review integrity ignores via and enforces the gate", async () => {
  await withTempGitRepo(async (dir) => {
    await commitPolicy(dir, { reviewIntegrity: true });
    const runDir = await newRun(dir, "strict-close");
    await toReviewing(runDir);
    await expect(closeRun({ runDir, via: "arg" })).rejects.toThrow(/self review is missing/);
  });
});

test("closePreview reports missing reviews, a large change, tests, and decided questions", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "preview");
    await toReviewing(runDir);
    expect(await closePreview(runDir)).toMatchObject({
      recommend: "n",
      reasons: ["missing self review"],
    });
    vi.mocked(git.treeDiffSize).mockResolvedValueOnce({ files: 9, added: 90, deleted: 9 });
    expect((await closePreview(runDir)).reasons).toEqual([
      "missing self review",
      "missing cross review",
    ]);
    await startStage({ runDir, stage: "self-review", tool: "cursor" });
    const self = await doneStage({ runDir, stage: "self-review", tool: "cursor" });
    const tree = self.tree;
    await addEvents(runDir, [{
      stage: "self-review",
      action: "completed",
      tree,
      tests: { exit: 1, ms: 1, tree: tree! },
    }]);
    expect((await closePreview(runDir)).reasons).toEqual(["failed tests"]);
    await addEvents(runDir, [{
      stage: "self-review",
      action: "completed",
      tree,
      tests: "not-configured",
    }]);
    expect((await closePreview(runDir)).reasons).toEqual([]);
    await addEvents(runDir, [{
      stage: "self-review",
      action: "completed",
      tree,
      tests: { exit: 0, ms: 1, tree: tree! },
    }]);
    expect((await closePreview(runDir)).reasons).toEqual([]);

    const rel = "30-self-review/01.json";
    await writeFile(
      join(runDir, rel),
      `${JSON.stringify({ ...review, open: [{ q: "Which?", a: "A", b: "B" }] })}\n`,
    );
    await addEvents(runDir, [
      { stage: "self-review", action: "completed", tree, ref: rel },
      {
        stage: "self-review",
        action: "decided",
        ref: "30-self-review/09.json",
        question: "Which?",
        answer: "a",
      },
    ]);
    expect((await closePreview(runDir)).reasons).toEqual(["open items"]);
    await addEvents(runDir, [
      { stage: "self-review", action: "decided", ref: rel, question: "Which?", answer: "a" },
    ]);
    expect((await closePreview(runDir)).reasons).toEqual([]);
  });
});

test("closePreview reports whether close removes or keeps the worktree", async () => {
  await withTempGitRepo(async (dir) => {
    const runDir = await newRun(dir, "preview-wt");
    await toReviewing(runDir);
    await setWorktree(runDir, dir);
    vi.mocked(worktree.keepReason).mockResolvedValueOnce(null).mockResolvedValueOnce("dirty");
    expect((await closePreview(runDir)).worktree).toEqual({ remove: true });
    expect((await closePreview(runDir)).worktree).toEqual({ remove: false, reason: "dirty" });
  });
});

test("close records cleanup after removal, survives an event failure, and keeps a worktree", async () => {
  await withTempGitRepo(async (dir) => {
    const outcomes = [
      { slug: "wt-removed", removal: { removed: true }, failEvent: false },
      { slug: "wt-swallow", removal: { removed: true }, failEvent: true },
      { slug: "wt-kept", removal: { removed: false, reason: "dirty" }, failEvent: false },
    ];
    for (const outcome of outcomes) {
      const runDir = await newRun(dir, outcome.slug);
      await toReviewing(runDir);
      await setWorktree(runDir, dir);
      vi.mocked(worktree.removeMergedWorktree).mockResolvedValueOnce(outcome.removal);
      if (outcome.failEvent) {
        const actual = vi.mocked(mutate.appendEvent).getMockImplementation();
        vi.mocked(mutate.appendEvent).mockImplementation(async (loaded, path, line) => {
          if (line.action === "cleaned") throw new Error("disk");
          return actual!(loaded, path, line);
        });
      }
      const closed = await closeRun({ runDir, waiveReview: "skip", ackOpen: true });
      expect(closed.worktree).toEqual(outcome.removal);
      vi.mocked(mutate.appendEvent).mockReset();
      const lines = await readFile(join(runDir, "events.jsonl"), "utf8");
      expect(lines.includes("\"cleaned\"")).toBe(outcome.removal.removed && !outcome.failEvent);
    }
  });
});
