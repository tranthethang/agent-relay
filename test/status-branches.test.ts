import * as fsPromises from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as cache from "../src/core/cache.js";
import { contextFor, type ContextResult, contextText } from "../src/core/context.js";
import { RelayError } from "../src/core/error.js";
import * as lifecycle from "../src/core/lifecycle.js";
import {
  reviewEvidenceFor,
  type StatusDetail,
  statusDetail,
  statusDetailText,
  statusList,
  statusListText,
  type StatusReviews,
} from "../src/core/status.js";
import { withTempDir } from "./helper.js";
import { createdEvent, plannedState, runCache, runName, seedRelay, seedRun } from "./seed.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

vi.mock("../src/core/cache.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/cache.js")>();
  return { ...actual, rebuildRun: vi.fn(actual.rebuildRun) };
});

vi.mock("../src/core/lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/lifecycle.js")>();
  return { ...actual, reviewIntegrity: vi.fn(actual.reviewIntegrity) };
});

const now = Date.parse("2026-10-17T02:00:00.000Z");

afterEach(() => {
  vi.mocked(fsPromises.stat).mockClear();
  vi.mocked(cache.rebuildRun).mockClear();
  vi.mocked(lifecycle.reviewIntegrity).mockClear();
});

const baseReviews: StatusReviews = {
  required: [],
  done: [],
  treeMatch: null,
  waived: false,
  self: null,
  cross: null,
};

function detailWith(overrides: Partial<StatusDetail>): StatusDetail {
  return {
    schema: 1,
    name: runName,
    id: "1792208725",
    ymd: "20261017",
    slug: "next-state-cli-base",
    title: "v2 P3",
    base: "abc",
    stage: "plan",
    lifecycle: "planned",
    approved: false,
    age: "1h",
    tasks: [],
    next: "none",
    actions: [],
    reviews: baseReviews,
    actors: {},
    drift: 0,
    findings: { open: 0, highOpen: 0 },
    ...overrides,
  };
}

test("statusListText prints none for an empty list", () => {
  expect(statusListText({ schema: 1, runs: [] })).toBe("runs: none\n");
});

test("statusDetailText prints approved, tasks, tree match, delta, and evidence", () => {
  const text = statusDetailText(detailWith({
    approved: true,
    tasks: [{ id: "T1", status: "done" }],
    actions: ["atry next"],
    actors: { approve: "me", close: "you" },
    reviews: {
      required: ["self", "cross"],
      done: ["self"],
      treeMatch: true,
      delta: { files: 1, added: 2, deleted: 3 },
      waived: true,
      self: {
        path: "30-self-review/1.json",
        kind: "self",
        claimed: { tool: "cursor", model: "m", open: 0 },
        measured: {
          detected: "cursor",
          tests: { exit: 0, ms: 5, tree: "t" },
          delta: { files: 1, added: 2, deleted: 3 },
          decided: 0,
        },
      },
      cross: {
        path: "40-cross-review/1.json",
        kind: "cross",
        claimed: { tool: "codex", model: "m", open: 1 },
        measured: { detected: null, tests: null, delta: null, decided: 0 },
      },
    },
  }));
  expect(text).toContain("approved: yes");
  expect(text).toContain("tasks: T1 done");
  expect(text).toContain("actions: atry next");
  expect(text).toContain(
    "reviews required=self,cross done=self tree-match=yes delta=1 2 3 waived=yes",
  );
  expect(text).toContain("detected=cursor (measured) tests=exit=0 ms=5 (measured) delta=1 2 3");
  expect(text).toContain("detected=none (measured) tests=unknown (measured) delta=none");
  expect(text).toContain("actors approve=me close=you");
});

test("statusDetailText prints tree-match no", () => {
  const text = statusDetailText(detailWith({ reviews: { ...baseReviews, treeMatch: false } }));
  expect(text).toContain("reviews required=none done=none tree-match=no delta=none waived=no");
});

test("status text prints a string test result and defaults for missing fields", () => {
  const detail = detailWith({
    reviews: {
      ...baseReviews,
      self: {
        path: "30-self-review/1.json",
        kind: "self",
        claimed: { tool: "codex", model: "m", open: 0 },
        measured: { detected: null, tests: "not-configured", delta: null, decided: 0 },
      },
    },
  });
  const text = statusDetailText(detail);
  expect(text).toContain("approved: no");
  expect(text).toContain("tasks: none");
  expect(text).toContain("actions: none");
  expect(text).toContain("tests=not-configured (measured)");
  expect(text).toContain("actors approve=unknown close=unknown");
});

test("reviewEvidenceFor ignores a review folder without numbered JSON files", async () => {
  await withTempDir(async (root) => {
    const folder = join(root, "30-self-review");
    await mkdir(folder);
    await writeFile(join(folder, "README.md"), "not a review\n");
    expect(await reviewEvidenceFor(root, [], "self")).toBeNull();
  });
});

test("statusList rethrows an error that is not a RelayError", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    vi.mocked(cache.rebuildRun).mockRejectedValueOnce(new Error("boom"));
    await expect(statusList(relay, now)).rejects.toThrow("boom");
  });
});

test("statusList rethrows a stat error that is not ENOENT", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    vi.mocked(fsPromises.stat).mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    await expect(statusList(relay, now)).rejects.toThrow("denied");
  });
});

test("statusList uses the cache mtime when there are no events", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), []);
    const list = await statusList(relay, Date.now());
    expect(list.runs).toHaveLength(1);
    expect(list.runs[0]?.age).toMatch(/^\d+[smhd]$/);
  });
});

test("statusDetail rethrows an unexpected review integrity error", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    vi.mocked(lifecycle.reviewIntegrity).mockRejectedValueOnce(
      new RelayError("validation", "other failure", "base"),
    );
    await expect(statusDetail(runDir, now)).rejects.toThrow("other failure");
  });
});

test("statusDetail falls back when the git index is missing and keeps the delta", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(
      relay,
      runName,
      runCache({ ...plannedState, lifecycle: "reviewing", stage: "self-review", approved: true }),
      [
        createdEvent,
        {
          schema: 1,
          ts: "2026-10-17T00:01:00.000Z",
          stage: "self-review",
          action: "completed",
          delta: { files: 2, added: 4, deleted: 1 },
        },
      ],
    );
    vi.mocked(lifecycle.reviewIntegrity).mockRejectedValueOnce(
      new RelayError("validation", "git index not found", "base"),
    );
    const detail = await statusDetail(runDir, now);
    expect(detail.reviews).toMatchObject({
      required: ["self"],
      done: ["self"],
      treeMatch: null,
      delta: { files: 2, added: 4, deleted: 1 },
      waived: false,
    });
  });
});

test("reviewEvidenceFor rethrows a readdir error that is not ENOENT", async () => {
  await withTempDir(async (root) => {
    await writeFile(join(root, "30-self-review"), "not a directory", "utf8");
    await expect(reviewEvidenceFor(root, [], "self")).rejects.toMatchObject({
      code: expect.stringMatching(/^E/),
    });
  });
});

test("reviewEvidenceFor rejects a review that fails the schema", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "40-cross-review"));
    await writeFile(join(root, "40-cross-review", "1.json"), "{\"schema\":1}\n", "utf8");
    await expect(reviewEvidenceFor(root, [], "cross")).rejects.toMatchObject({
      fieldPath: "40-cross-review/1.json",
    });
  });
});

function contextWith(overrides: Partial<ContextResult>): ContextResult {
  return {
    schema: 1,
    run: { name: runName, path: "/x", id: "1", ymd: "20261017", slug: "s", title: "t", base: "b" },
    stage: "plan",
    lifecycle: "planned",
    approved: false,
    tasks: [],
    reviews: { self: null, cross: null },
    brainstorm: null,
    paths: {
      plan: [],
      implement: [],
      "self-review": [],
      "cross-review": [],
      distill: [],
      run: [],
    },
    ...overrides,
  };
}

test("contextText prints approved, brainstorm, tasks, and the focused task", () => {
  const text = contextText(contextWith({
    approved: true,
    brainstorm: "brainstorms/x",
    tasks: [{
      id: "T1",
      status: "done",
      path: "10-plan/T1.md",
      implement: "20-implement/T1.md",
      files: [],
    }],
    task: { id: "T1", plan: "10-plan/T1.md", implement: "20-implement/T1.md" },
  }));
  expect(text).toBe(
    [
      `run: ${runName}`,
      "stage: plan",
      "status: planned",
      "approved: yes",
      "brainstorm: brainstorms/x",
      "tasks: T1 done",
      "plan: 10-plan/T1.md",
      "implement: 20-implement/T1.md",
      "",
    ].join("\n"),
  );
});

test("contextText prints none for missing brainstorm and tasks", () => {
  const text = contextText(contextWith({}));
  expect(text).toContain("approved: no");
  expect(text).toContain("brainstorm: none");
  expect(text).toContain("tasks: none");
});

test("contextFor warns on a stale cache and marks index-only tasks pending", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(
      relay,
      runName,
      runCache({ ...plannedState, approved: true }),
      [createdEvent],
    );
    await mkdir(join(runDir, "10-plan"));
    await writeFile(
      join(runDir, "10-plan", "index.json"),
      `${
        JSON.stringify({
          schema: 1,
          tasks: [{ id: "T1", title: "One", deps: [], files: [], path: "10-plan/T1.md" }],
        })
      }\n`,
      "utf8",
    );
    const result = await contextFor(runDir, undefined);
    expect(result.warnings).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ id: "T1", status: "pending" });
  });
});

test("contextFor rethrows an index read error that is not ENOENT or invalid JSON", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    await mkdir(join(runDir, "10-plan", "index.json"), { recursive: true });
    await expect(contextFor(runDir, undefined)).rejects.toMatchObject({
      code: expect.stringMatching(/^E/),
    });
  });
});

test("contextFor reports the index file when the index root is invalid", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    await mkdir(join(runDir, "10-plan"));
    await writeFile(join(runDir, "10-plan", "index.json"), "1\n", "utf8");
    await expect(contextFor(runDir, undefined)).rejects.toMatchObject({
      fieldPath: "10-plan/index.json",
    });
  });
});

test("contextFor rejects an invalid task id", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    await expect(contextFor(runDir, "bad id")).rejects.toMatchObject({ fieldPath: "task" });
  });
});

test("reviewEvidenceFor reports a review that is not JSON", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "30-self-review"));
    await writeFile(join(root, "30-self-review", "1.json"), "{", "utf8");
    await expect(reviewEvidenceFor(root, [], "self")).rejects.toMatchObject({
      message: "could not read review",
      fieldPath: "30-self-review/1.json",
    });
  });
});
