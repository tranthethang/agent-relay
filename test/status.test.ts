import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { statusDetail, statusDetailText, statusList, statusListText } from "../src/core/status.js";
import { runCli, withTempDir } from "./helper.js";
import { createdEvent, plannedState, runCache, runName, seedRelay, seedRun } from "./seed.js";

function reviewJson(kind: string, findings: unknown[] | undefined): string {
  return `${
    JSON.stringify({
      schema: 1,
      kind,
      tool: "cursor",
      model: "unknown",
      ...(findings === undefined ? { fixed: 2 } : { findings }),
      open: [],
    })
  }\n`;
}

function finding(id: string, severity: string, status: string): Record<string, unknown> {
  return { id, severity, status, file: null, line: null, evidence: "e" };
}

async function seedReviews(runDir: string): Promise<void> {
  await mkdir(join(runDir, "30-self-review"), { recursive: true });
  await mkdir(join(runDir, "40-cross-review"), { recursive: true });
  await writeFile(
    join(runDir, "30-self-review", "01.json"),
    reviewJson("self", [finding("F1", "high", "open"), finding("F2", "low", "fixed")]),
  );
  await writeFile(join(runDir, "30-self-review", "02.json"), reviewJson("self", undefined));
  await writeFile(
    join(runDir, "40-cross-review", "01.json"),
    reviewJson("cross", [finding("F1", "medium", "open")]),
  );
}

const now = Date.parse("2026-10-17T02:00:00.000Z");

test("statusList skips a directory that has no run.json", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    await mkdir(join(relay, "20261018-1792208726-other-run"), { recursive: true });
    const list = await statusList(relay, now);
    expect(list.runs).toHaveLength(1);
    expect(list.runs[0]).toMatchObject({
      name: runName,
      id: "1792208725",
      stage: "plan",
      lifecycle: "planned",
      age: "2h",
      next: "atry approve 1792208725",
      actions: ["atry approve 1792208725"],
    });
  });
});

test("statusList skips a run with invalid events and warns", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    const bad = await seedRun(relay, "20261018-1792208726-other-run", runCache(plannedState), []);
    await writeFile(join(bad, "events.jsonl"), "not json\n", "utf8");
    const list = await statusList(relay, now);
    expect(list.runs.map((run) => run.name)).toEqual([runName]);
    expect(list.warnings).toHaveLength(1);
    expect(list.warnings?.[0]).toContain("20261018-1792208726-other-run");
  });
});

test("statusDetail rebuilds a stale cache", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(relay, runName, runCache(plannedState), [
      createdEvent,
      { schema: 1, ts: "2026-10-17T01:00:00.000Z", stage: "plan", action: "approved" },
    ]);
    const detail = await statusDetail(runDir, now);
    expect(detail.lifecycle).toBe("approved");
    expect(detail.approved).toBe(true);
    expect(detail.warnings).toEqual(["run.json disagreed with events.jsonl; rebuilt"]);
    expect(detail.drift).toBe(1);
    expect(statusDetailText(detail)).toContain("\ndrift: 1\n");
    expect((await statusDetail(runDir, now)).drift).toBe(1);
    expect(detail.next).toBe("atry stage start 1792208725 implement");
    expect(detail.actions).toEqual(["atry stage start 1792208725 implement"]);
    const stored = JSON.parse(await readFile(join(runDir, "run.json"), "utf8")) as {
      state: { approved: boolean };
    };
    expect(stored.state.approved).toBe(true);
  });
});

test("atry status prints the list and one run", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    const list = await runCli(["status"], root);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain(`${runName} plan planned`);
    expect(list.stdout).toContain("next: atry approve 1792208725");
    const one = await runCli(["status", "--json", "--run", "1792208725"], root);
    expect(one.code).toBe(0);
    expect(JSON.parse(one.stdout)).toMatchObject({
      schema: 1,
      id: "1792208725",
      lifecycle: "planned",
      approved: false,
    });
  });
});

test("statusList names the run in a cache rebuild warning", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    await seedRun(relay, runName, runCache(plannedState), [
      createdEvent,
      { ...createdEvent, stage: "plan", action: "approved" },
    ]);
    const list = await statusList(relay, now);
    expect(list.warnings).toEqual([`${runName}: run.json disagreed with events.jsonl; rebuilt`]);
  });
});

test("status shows claimed and measured data for self and cross reviews", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const reviewing = { ...plannedState, lifecycle: "closed", stage: "cross-review" };
    const self = {
      schema: 1,
      kind: "self",
      tool: "cursor",
      model: "claude-opus-4",
      fixed: 0,
      open: [{ q: "Keep?", a: "Yes", b: "No" }],
    };
    const cross = {
      schema: 1,
      kind: "cross",
      tool: "codex",
      model: "gpt-5.4",
      fixed: 0,
      open: [{ q: "Check?", need: "sample" }],
    };
    const runDir = await seedRun(relay, runName, runCache(reviewing), [
      createdEvent,
      {
        schema: 1,
        ts: "2026-10-17T00:01:00.000Z",
        stage: "plan",
        action: "approved",
        actor: "agent-env",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:02:00.000Z",
        stage: "self-review",
        action: "started",
        tool: "cursor",
        model: "claude-opus-4",
        detected: "codex",
        tree: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:03:00.000Z",
        stage: "self-review",
        action: "completed",
        tool: "cursor",
        model: "claude-opus-4",
        tests: { exit: 3, ms: 80, tree: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        delta: { files: 1, added: 1, deleted: 0 },
        ref: "30-self-review/01.json",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:04:00.000Z",
        stage: "self-review",
        action: "decided",
        question: "Keep?",
        answer: "a",
        ref: "30-self-review/01.json",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:05:00.000Z",
        stage: "cross-review",
        action: "started",
        tool: "codex",
        model: "gpt-5.4",
        detected: "codex",
        tree: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:06:00.000Z",
        stage: "cross-review",
        action: "completed",
        tool: "codex",
        model: "gpt-5.4",
        tests: "not-configured",
        ref: "40-cross-review/01.json",
      },
      {
        schema: 1,
        ts: "2026-10-17T00:07:00.000Z",
        stage: "run",
        action: "closed",
        actor: "unknown",
      },
    ]);
    await mkdir(join(runDir, "30-self-review"), { recursive: true });
    await mkdir(join(runDir, "40-cross-review"), { recursive: true });
    await writeFile(join(runDir, "30-self-review", "01.json"), `${JSON.stringify(self)}\n`);
    await writeFile(join(runDir, "40-cross-review", "01.json"), `${JSON.stringify(cross)}\n`);
    const detail = await statusDetail(runDir, now);
    expect(detail.reviews.self).toMatchObject({
      claimed: { tool: "cursor", model: "claude-opus-4", open: 1 },
      measured: { detected: "codex", tests: { exit: 3, ms: 80 }, decided: 1 },
    });
    expect(detail.reviews.cross).toMatchObject({
      claimed: { tool: "codex", model: "gpt-5.4", open: 1 },
      measured: { detected: "codex", tests: "not-configured", decided: 0 },
    });
    expect(detail.actors).toMatchObject({ approve: "agent-env", close: "unknown" });
    const text = statusDetailText(detail);
    expect(text).toContain("tool=cursor (claimed)");
    expect(text).toContain("tests=exit=3 ms=80 (measured)");
    expect(text).toContain("open=1 (claimed) decided=1 (measured)");
    const list = await statusList(relay, now);
    expect(statusListText(list)).toContain("review cross tool=codex (claimed)");
    const cliText = await runCli(["status"], root);
    expect(cliText.stdout).toContain("review self tool=cursor (claimed)");
    expect(cliText.stdout).toContain("actors approve=agent-env close=unknown");
    const cliJson = await runCli(["status", "--json", "--run", "1792208725"], root);
    expect(cliJson.code).toBe(0);
    expect(JSON.parse(cliJson.stdout)).toMatchObject({
      reviews: {
        self: { claimed: { tool: "cursor", open: 1 }, measured: { decided: 1 } },
        cross: { claimed: { tool: "codex" }, measured: { tests: "not-configured" } },
      },
      actors: { approve: "agent-env", close: "unknown" },
    });
  });
});

test("status renders a run whose review JSON keeps the removed tests key", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const reviewing = { ...plannedState, lifecycle: "reviewing", stage: "self-review" };
    const runDir = await seedRun(relay, runName, runCache(reviewing), [createdEvent]);
    await mkdir(join(runDir, "30-self-review"), { recursive: true });
    await writeFile(
      join(runDir, "30-self-review", "01.json"),
      `${
        JSON.stringify({
          schema: 1,
          kind: "self",
          tool: "cursor",
          model: "unknown",
          fixed: 2,
          tests: "pass",
          open: [],
        })
      }\n`,
    );
    const cli = await runCli(["status", runName], root);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toContain(`run: ${runName}`);
    expect(cli.stdout).toContain("review self tool=cursor (claimed)");
    expect(cli.stderr).not.toContain("30-self-review");
    const detail = await statusDetail(runDir, now);
    expect(detail.reviews.self?.claimed).toMatchObject({ tool: "cursor", open: 0 });
  });
});

test("status warns and keeps the run when a review JSON cannot be read", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const reviewing = { ...plannedState, lifecycle: "reviewing", stage: "self-review" };
    const runDir = await seedRun(relay, runName, runCache(reviewing), [createdEvent]);
    await mkdir(join(runDir, "30-self-review"), { recursive: true });
    await writeFile(
      join(runDir, "30-self-review", "01.json"),
      `${
        JSON.stringify({
          schema: 1,
          kind: "self",
          tool: "cursor",
          model: "unknown",
          fixed: 0,
          open: [],
          nope: true,
        })
      }\n`,
    );
    const cli = await runCli(["status", runName], root);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toContain(`run: ${runName}`);
    expect(cli.stderr).toContain("warning: 30-self-review/01.json");
    expect(cli.stderr).toContain("nope");
    const detail = await statusDetail(runDir, now);
    expect(detail.reviews.self).toBeNull();
    expect(detail.warnings?.[0]).toContain("30-self-review/01.json");
  });
});

test("status does not recommend implement completion without a valid index", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const name = "20261017-1792208800-open-index";
    const events = [
      createdEvent,
      { schema: 1, ts: "2026-10-17T00:01:00.000Z", stage: "plan", action: "approved" },
      {
        schema: 1,
        ts: "2026-10-17T00:02:00.000Z",
        stage: "implement",
        action: "started",
        tool: "cursor",
      },
    ];
    const cache = {
      ...(runCache(plannedState) as { id: string; slug: string }),
      id: "1792208800",
      slug: "open-index",
    };
    const runDir = await seedRun(relay, name, cache, events);
    await expect(statusDetail(runDir, now)).rejects.toMatchObject({
      fieldPath: "10-plan/index.json",
    });
    const list = await statusList(relay, now);
    expect(list.runs).toEqual([]);
    expect(list.warnings?.[0]).toContain("index.json not found");
    const cli = await runCli(["status", "--json", name], root);
    expect(cli.code).toBe(3);
    expect(cli.stdout).not.toContain("atry stage done");

    await mkdir(join(runDir, "10-plan"), { recursive: true });
    await writeFile(
      join(runDir, "10-plan", "index.json"),
      `${
        JSON.stringify({
          schema: 1,
          tasks: [{
            id: "T1",
            title: "First",
            deps: [],
            files: [],
            path: "10-plan/T1.md",
          }],
        })
      }\n`,
    );
    const detail = await statusDetail(runDir, now);
    expect(detail.next).toBe("atry task start 1792208800");
    expect(detail.lifecycle).toBe("implementing");
  });
});

test("statusDetail counts findings from the latest review of each kind", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    await seedReviews(runDir);
    const detail = await statusDetail(runDir, now);
    expect(detail.findings).toEqual({ open: 1, highOpen: 0 });
    expect(statusDetailText(detail)).toContain("\nfindings: 1 open, 0 high open\n");
    await writeFile(
      join(runDir, "30-self-review", "03.json"),
      reviewJson("self", [finding("F1", "high", "open")]),
    );
    expect((await statusDetail(runDir, now)).findings).toEqual({ open: 2, highOpen: 1 });
  });
});

test("statusDetail counts an unreadable latest review as zero findings", async () => {
  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const runDir = await seedRun(relay, runName, runCache(plannedState), [createdEvent]);
    await mkdir(join(runDir, "30-self-review"), { recursive: true });
    await writeFile(join(runDir, "30-self-review", "01.json"), "not json\n");
    const detail = await statusDetail(runDir, now);
    expect(detail.findings).toEqual({ open: 0, highOpen: 0 });
  });
});
