import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type RebuildResult } from "../src/core/cache.js";
import { decideQuestion, decideText } from "../src/core/decide.js";
import { type EventLine } from "../src/core/event.js";
import {
  diversityWarnings,
  readReviewDocument,
  reviewDone,
  reviewNew,
} from "../src/core/review.js";
import { type TestExecution } from "../src/core/testrun.js";
import { withTempDir } from "./helper.js";

const fake = vi.hoisted(() => ({
  loaded: undefined as unknown,
  appended: [] as Record<string, unknown>[],
  testCommand: undefined as string | undefined,
  execution: undefined as unknown,
  onTest: undefined as (() => void) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

vi.mock("../src/core/mutate.js", () => ({
  withRunLock: (_runDir: string, fn: (loaded: unknown) => Promise<unknown>) => fn(fake.loaded),
  appendEvent: (loaded: unknown, _runDir: string, event: Record<string, unknown>) => {
    fake.appended.push(event);
    return Promise.resolve(loaded);
  },
}));

vi.mock("../src/core/git.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/core/git.js")>(),
  gitHead: () => Promise.resolve("h".repeat(40)),
  gitRoot: (cwd: string) => Promise.resolve(cwd),
  workTree: () => Promise.resolve(treeB),
  treeDiffSize: () => Promise.resolve({ files: 1, added: 2, deleted: 3 }),
}));

vi.mock("../src/core/worktree.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/core/worktree.js")>(),
  runGitCwd: (runDir: string) => Promise.resolve(runDir),
}));

vi.mock("../src/core/policy.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/core/policy.js")>(),
  readPolicy: () => Promise.resolve({ testCommand: fake.testCommand }),
}));

vi.mock("../src/core/testrun.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/core/testrun.js")>(),
  runTestCommand: () => {
    fake.onTest?.();
    return Promise.resolve(fake.execution);
  },
}));

const treeA = "a".repeat(40);
const treeB = "b".repeat(40);
const notConfigured: TestExecution = { tests: "not-configured", stdout: "", stderr: "" };

function event(fields: Partial<EventLine> & Pick<EventLine, "stage" | "action">): EventLine {
  return { schema: 1, ts: "2026-10-20T00:00:00Z", ...fields };
}

function useEvents(events: EventLine[], lifecycle = "reviewing"): void {
  const loaded = {
    run: { state: { lifecycle, tasks: [] }, base: "base" },
    events,
    warning: null,
  };
  fake.loaded = loaded as unknown as RebuildResult;
}

function reviewBody(kind: "self" | "cross", model: string, open: unknown[] = []): string {
  return `${JSON.stringify({ schema: 1, kind, tool: "cursor", model, findings: [], open })}\n`;
}

async function writeReview(
  runDir: string,
  rel: string,
  body: string,
  cards: string[] = [],
): Promise<void> {
  const path = join(runDir, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body);
  const markdown = cards.map((card, index) => `- Q${index + 1}: ${card}\n`).join("");
  await writeFile(path.replace(/\.json$/, ".md"), `# review\n\n${markdown}\n\n## Acceptance\n`);
  await mkdir(join(runDir, "10-plan"), { recursive: true });
  await writeFile(
    join(runDir, "10-plan", "index.json"),
    `${JSON.stringify({ schema: 1, tasks: [] })}\n`,
  );
}

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

const selfStart = event({
  stage: "self-review",
  action: "started",
  tool: "cursor",
  model: "unknown",
  tree: treeA,
});

beforeEach(() => {
  fake.appended = [];
  fake.testCommand = undefined;
  fake.execution = notConfigured;
  fake.onTest = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("reviewNew warns on a detected tool and skips a taken label", async () => {
  await withTempDir(async (runDir) => {
    useEvents([]);
    vi.stubEnv("CODEX_THREAD_ID", "thread");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await mkdir(join(runDir, "30-self-review"));
    await writeFile(join(runDir, "30-self-review", "01.md"), "taken\n");
    vi.mocked(readdir).mockResolvedValueOnce([]);
    const result = await reviewNew({ runDir, kind: "self", tool: "cursor" });
    expect(result.markdown).toBe(join(runDir, "30-self-review", "02.md"));
    expect(stderr).toHaveBeenCalledWith(
      "warning: detected tool codex differs from declared cursor\n",
    );
    expect(fake.appended[0]).toMatchObject({ detected: "codex", model: "unknown" });
  });
});

test("reviewNew treats a vanished review dir as empty and rethrows other errors", async () => {
  await withTempDir(async (runDir) => {
    useEvents([]);
    vi.stubEnv("CODEX_THREAD_ID", "");
    vi.mocked(readdir).mockRejectedValueOnce(errnoError("ENOENT"));
    const result = await reviewNew({ runDir, kind: "self", tool: "cursor" });
    expect(result.json).toBe(join(runDir, "30-self-review", "01.json"));
    expect(fake.appended[0]).not.toHaveProperty("detected");
    vi.mocked(readdir).mockRejectedValueOnce(errnoError("EACCES"));
    await expect(reviewNew({ runDir, kind: "self", tool: "cursor" })).rejects.toThrow("EACCES");
  });
});

test("reviewDone refuses a review whose model differs from its start", async () => {
  await withTempDir(async (runDir) => {
    useEvents([selfStart]);
    await writeReview(runDir, "30-self-review/01.json", reviewBody("self", "other"));
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toThrow(
      "model differs from review start",
    );
  });
});

test("reviewDone reports a missing or unreadable review dir", async () => {
  await withTempDir(async (runDir) => {
    useEvents([selfStart]);
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toThrow("review not found");
    vi.mocked(readdir).mockRejectedValueOnce(errnoError("EACCES"));
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toThrow("EACCES");
  });
});

test("reviewDone records the current tree when tests ran without a start tree", async () => {
  await withTempDir(async (runDir) => {
    useEvents([selfStart]);
    fake.execution = { tests: { exit: 0, ms: 1 }, stdout: "out\r\n", stderr: "" };
    await writeReview(runDir, "30-self-review/01.json", reviewBody("self", "unknown"));
    const result = await reviewDone({ runDir, kind: "self" });
    expect(result.review).toBe("30-self-review/01.json");
    expect(fake.appended[0]).toMatchObject({
      tests: { exit: 0, ms: 1, tree: treeB },
      delta: { files: 1, added: 2, deleted: 3 },
    });
  });
});

test("reviewDone accepts prior questions that were carried or decided", async () => {
  await withTempDir(async (runDir) => {
    const previousRef = "40-cross-review/01.json";
    useEvents([
      event({ stage: "implement", action: "started", tool: "codex", model: "gpt-5.4" }),
      event({ stage: "implement", action: "completed", model: "claude-opus-4" }),
      event({ stage: "implement", action: "completed", tool: "cursor" }),
      event({ stage: "cross-review", action: "completed", ref: previousRef }),
      event({ stage: "cross-review", action: "decided", ref: "other.json", question: "Gone?" }),
      event({ stage: "cross-review", action: "decided", ref: previousRef, question: "Else?" }),
      event({ stage: "cross-review", action: "decided", ref: previousRef, question: "Gone?" }),
      event({ stage: "cross-review", action: "started", tool: "cursor", model: "gpt-5.5" }),
    ]);
    await writeReview(
      runDir,
      previousRef,
      reviewBody("cross", "gpt-5.5", [{ q: "Keep?", need: "x" }, { q: "Gone?", need: "y" }]),
    );
    await writeReview(
      runDir,
      "40-cross-review/02.json",
      reviewBody("cross", "gpt-5.5", [{ q: "Keep?", need: "x" }]),
      ["Keep?"],
    );
    const result = await reviewDone({ runDir, kind: "cross" });
    expect(result.review).toBe("40-cross-review/02.json");
    expect(result.warnings).toEqual(["cross tool matches implement tool"]);
  });
});

test("reviewDone refuses a prior review with a bad ref or bad JSON", async () => {
  await withTempDir(async (runDir) => {
    await writeReview(runDir, "30-self-review/02.json", reviewBody("self", "unknown"));
    useEvents([
      event({ stage: "self-review", action: "completed", ref: "bad.json" }),
      selfStart,
    ]);
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toThrow("invalid review ref");
    await writeFile(join(runDir, "30-self-review", "01.json"), "{\"schema\":1}\n");
    useEvents([
      event({ stage: "self-review", action: "completed", ref: "30-self-review/01.json" }),
      selfStart,
    ]);
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toMatchObject({
      fieldPath: expect.stringMatching(/^30-self-review\/01\.json:/),
    });
  });
});

test("readReviewDocument maps invalid JSON and root errors, and rethrows read errors", async () => {
  await withTempDir(async (runDir) => {
    await writeFile(join(runDir, "bad.json"), "{");
    await writeFile(join(runDir, "null.json"), "null\n");
    await expect(readReviewDocument(runDir, "bad.json")).rejects.toMatchObject({
      message: "invalid JSON",
      fieldPath: "bad.json",
    });
    await expect(readReviewDocument(runDir, "null.json")).rejects.toMatchObject({
      fieldPath: "null.json",
    });
    await expect(readReviewDocument(runDir, "missing.json")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

test("diversityWarnings flags a cross tool that matches the self-review tool", () => {
  const review = { schema: 1, kind: "cross", tool: "cursor", model: "m", findings: [], open: [] };
  expect(diversityWarnings(review as never, undefined, { tool: "cursor" })).toEqual([
    "cross tool matches self-review tool",
  ]);
});

test("decideQuestion refuses a run without a completed review", async () => {
  await withTempDir(async (runDir) => {
    useEvents([event({ stage: "self-review", action: "started" })]);
    await expect(decideQuestion({ runDir, questionId: "Q1", answer: "a" })).rejects.toThrow(
      "completed review not found",
    );
  });
});

test("decideQuestion refuses a cross review ref outside its folder", async () => {
  await withTempDir(async (runDir) => {
    useEvents([
      event({ stage: "cross-review", action: "completed", ref: "30-self-review/01.json" }),
    ]);
    await expect(decideQuestion({ runDir, questionId: "Q1", answer: "a" })).rejects.toThrow(
      "invalid review ref",
    );
  });
});

test("reviewNew validates kind, lifecycle, tool, and model", async () => {
  await withTempDir(async (runDir) => {
    vi.stubEnv("CODEX_THREAD_ID", "");
    useEvents([], "implementing");
    await expect(reviewNew({ runDir, kind: "self", tool: "cursor" })).rejects.toThrow(
      "review refused: run is implementing",
    );
    useEvents([]);
    await expect(reviewNew({ runDir, kind: "bogus", tool: "cursor" })).rejects.toThrow(
      "invalid kind",
    );
    await expect(reviewNew({ runDir, kind: "self", tool: "bogus" })).rejects.toThrow(
      "invalid tool",
    );
    await expect(reviewNew({ runDir, kind: "cross", tool: "cursor" })).rejects.toThrow(
      "cross review requires --model",
    );
    await expect(reviewNew({ runDir, kind: "cross", tool: "cursor", model: " " })).rejects
      .toThrow("cross review requires --model");
    await expect(reviewNew({ runDir, kind: "self", tool: "cursor", model: " " })).rejects
      .toThrow("model is empty");
    await mkdir(join(runDir, "40-cross-review"));
    await writeFile(join(runDir, "40-cross-review", "notes.txt"), "x\n");
    await writeFile(join(runDir, "40-cross-review", "03.json"), "{}\n");
    const result = await reviewNew({ runDir, kind: "cross", tool: "cursor", model: "gpt-5.5" });
    expect(result.json).toBe(join(runDir, "40-cross-review", "04.json"));
    expect(fake.appended[0]).toMatchObject({ stage: "cross-review", model: "gpt-5.5" });
  });
});

test("reviewDone refuses bad lifecycle, kind, tool, cards, and empty dirs", async () => {
  await withTempDir(async (runDir) => {
    useEvents([selfStart], "implementing");
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toThrow("run is implementing");
    useEvents([selfStart, event({ stage: "implement", action: "completed" })]);
    await mkdir(join(runDir, "30-self-review"));
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toThrow("review not found");
    await writeReview(runDir, "30-self-review/01.json", reviewBody("cross", "unknown"));
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toThrow("kind does not match");
    await writeReview(runDir, "30-self-review/01.json", reviewBody("self", "unknown"));
    useEvents([]);
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toThrow(
      "tool differs from review start",
    );
    useEvents([selfStart]);
    await writeReview(
      runDir,
      "30-self-review/01.json",
      reviewBody("self", "unknown", [{ q: "Q?", need: "x" }]),
    );
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toThrow(
      "review Markdown has 0 question cards but JSON has 1 open items",
    );
  });
});

test("reviewDone refuses a prior question dropped without a decision", async () => {
  await withTempDir(async (runDir) => {
    const previousRef = "30-self-review/01.json";
    await writeReview(runDir, previousRef, reviewBody("self", "unknown", [{ q: "Q?", need: "x" }]));
    await writeReview(runDir, "30-self-review/02.json", reviewBody("self", "unknown"));
    useEvents([event({ stage: "self-review", action: "completed", ref: previousRef }), selfStart]);
    await expect(reviewDone({ runDir, kind: "self" })).rejects.toThrow(
      "open question was dropped without a decision: Q?",
    );
  });
});

test("reviewDone runs the policy test command between two lock holds", async () => {
  await withTempDir(async (runDir) => {
    const events = [selfStart];
    useEvents(events);
    fake.testCommand = "npm test";
    fake.execution = { tests: { exit: 1, ms: 5 }, stdout: "a\r\nb", stderr: "e\n" };
    await writeReview(runDir, "30-self-review/01.json", reviewBody("self", "unknown"));
    const result = await reviewDone({ runDir, kind: "self", testTimeoutMs: 1000, runTests: true });
    expect(result.action).toBe("completed");
    expect(fake.appended[0]).toMatchObject({ tests: { exit: 1, ms: 5, tree: treeB } });
    fake.onTest = () => {
      events.push(event({ stage: "self-review", action: "started" }));
    };
    await expect(reviewDone({ runDir, kind: "self", runTests: true })).rejects.toThrow(
      "the review stage changed while tests ran",
    );
  });
});

test("readReviewDocument names the failing field", async () => {
  await withTempDir(async (runDir) => {
    await writeFile(join(runDir, "partial.json"), "{\"schema\":1}\n");
    await expect(readReviewDocument(runDir, "partial.json")).rejects.toMatchObject({
      fieldPath: expect.stringMatching(/^partial\.json:/),
    });
  });
});

test("diversityWarnings flags a matching vendor with known models", () => {
  const review = {
    schema: 1,
    kind: "cross",
    tool: "codex",
    model: "gpt-5.5",
    findings: [],
    open: [],
  };
  expect(diversityWarnings(review as never, { model: "gpt-4o" }, undefined)).toContain(
    "cross model vendor matches implement model",
  );
});

async function decideSetup(runDir: string, extra: EventLine[] = []): Promise<void> {
  const ref = "30-self-review/01.json";
  await writeReview(
    runDir,
    ref,
    reviewBody("self", "unknown", [{ q: "Choose?", a: "A", b: "B" }, { q: "Need?", need: "x" }]),
  );
  useEvents([event({ stage: "self-review", action: "completed", ref }), ...extra]);
}

test("decideQuestion validates input and records an answer", async () => {
  await withTempDir(async (runDir) => {
    await decideSetup(runDir);
    await expect(decideQuestion({ runDir, questionId: "Q0", answer: "a" })).rejects.toThrow(
      "invalid question id",
    );
    await expect(decideQuestion({ runDir, questionId: "Q1", answer: " " })).rejects.toThrow(
      "answer is empty",
    );
    await expect(decideQuestion({ runDir, questionId: "Q3", answer: "a" })).rejects.toThrow(
      "question id is outside the open list",
    );
    await expect(decideQuestion({ runDir, questionId: "Q1", answer: "c" })).rejects.toThrow(
      "choice answer must be a or b",
    );
    const result = await decideQuestion({ runDir, questionId: "Q2", answer: " sample " });
    expect(decideText(result)).toBe(
      "review: 30-self-review/01.json\nquestion: Need?\nanswer: sample\naction: decided\n",
    );
    const choice = await decideQuestion({ runDir, questionId: "Q1", answer: "b" });
    expect(choice.answer).toBe("b");
    await decideSetup(runDir, [
      event({ stage: "self-review", action: "decided", ref: "other.json", question: "Choose?" }),
      event({
        stage: "self-review",
        action: "decided",
        ref: "30-self-review/01.json",
        question: "Need?",
      }),
      event({
        stage: "self-review",
        action: "decided",
        ref: "30-self-review/01.json",
        question: "Choose?",
      }),
    ]);
    await expect(decideQuestion({ runDir, questionId: "Q1", answer: "a" })).rejects.toThrow(
      "question already decided",
    );
  });
});

test("decideQuestion refuses an unreadable or invalid completed review", async () => {
  await withTempDir(async (runDir) => {
    useEvents([
      event({ stage: "self-review", action: "completed", ref: "30-self-review/09.json" }),
    ]);
    await expect(decideQuestion({ runDir, questionId: "Q1", answer: "a" })).rejects.toThrow(
      "could not read completed review",
    );
    await mkdir(join(runDir, "30-self-review"));
    await writeFile(join(runDir, "30-self-review", "09.json"), "{}\n");
    await expect(decideQuestion({ runDir, questionId: "Q1", answer: "a" })).rejects.toThrow(
      "invalid completed review",
    );
  });
});
