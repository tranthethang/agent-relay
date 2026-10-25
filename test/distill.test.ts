import { Command } from "commander";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { takeRun } from "../src/cli/distill.js";
import { lineHash } from "../src/core/cache.js";
import { labelPath } from "../src/core/distill-label.js";
import { distillRun, verifyDistill } from "../src/core/distill.js";
import { gitCommit, runCli, withTempDir, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

test("atry distill writes sha256 entries and appends no event", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-run");
    const before = await readFile(join(run, "events.jsonl"), "utf8");
    const created = await runCli(["distill", run, "--json"], dir);
    expect(created.code).toBe(0);
    const body = JSON.parse(created.stdout) as { path: string; files: number };
    expect(body.path).toBe(join(run, "90-distill", "manifest.json"));
    const manifest = JSON.parse(await readFile(body.path, "utf8")) as {
      schema: number;
      files: { path: string; size: number; sha256: string }[];
    };
    expect(manifest.schema).toBe(1);
    expect(body.files).toBe(manifest.files.length);
    expect(manifest.files.some((file) => file.path === "90-distill/manifest.json")).toBe(false);
    const events = manifest.files.find((file) => file.path === "events.jsonl");
    const raw = await readFile(join(run, "events.jsonl"));
    expect(events).toEqual({
      path: "events.jsonl",
      size: raw.byteLength,
      sha256: createHash("sha256").update(raw).digest("hex"),
      kind: "events",
    });
    const paths = manifest.files.map((file) => file.path);
    expect(paths).toEqual([...paths].sort());
    expect(await readFile(join(run, "events.jsonl"), "utf8")).toBe(before);
    const again = await runCli(["distill", run], dir);
    expect(again.code).toBe(0);
    expect(await readFile(join(run, "events.jsonl"), "utf8")).toBe(before);
  });
});

test("atry distill skips locks and temp files", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-skip");
    const first = await runCli(["distill", run, "--json"], dir);
    expect(first.code).toBe(0);
    const before = JSON.parse(
      await readFile(join(run, "90-distill", "manifest.json"), "utf8"),
    ) as { files: { path: string }[] };
    await mkdir(join(run, "locks"), { recursive: true });
    await writeFile(join(run, "locks", "T1.lock"), "lock\n");
    await writeFile(join(run, ".events.jsonl.abcd.tmp"), "tmp\n");
    await writeFile(join(run, "extra.txt"), "keep\n");
    const second = await runCli(["distill", run, "--json"], dir);
    expect(second.code).toBe(0);
    const after = JSON.parse(
      await readFile(join(run, "90-distill", "manifest.json"), "utf8"),
    ) as { files: { path: string }[] };
    const paths = after.files.map((file) => file.path);
    expect(paths.some((path) => path.startsWith("locks/"))).toBe(false);
    expect(paths.some((path) => path.endsWith(".tmp"))).toBe(false);
    expect(paths).toEqual([...before.files.map((file) => file.path), "extra.txt"].sort());
  });
});

test("atry distill leaves test logs out unless --include-test-logs is set", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-logs");
    await mkdir(join(run, "30-self-review"), { recursive: true });
    await writeFile(join(run, "30-self-review", "01.test.log"), "output\n");
    const skipped = await runCli(["distill", run, "--json"], dir);
    expect(skipped.code).toBe(0);
    const withoutLogs = JSON.parse(
      await readFile(join(run, "90-distill", "manifest.json"), "utf8"),
    ) as { files: { path: string }[] };
    expect(withoutLogs.files.some((file) => file.path.endsWith(".test.log"))).toBe(false);

    const included = await runCli(["distill", run, "--include-test-logs", "--json"], dir);
    expect(included.code).toBe(0);
    const withLogs = JSON.parse(
      await readFile(join(run, "90-distill", "manifest.json"), "utf8"),
    ) as { files: { path: string }[] };
    expect(withLogs.files.some((file) => file.path === "30-self-review/01.test.log")).toBe(true);
  });
});

test("atry distill works after the run is abandoned", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-closed");
    const abandoned = await runCli(["close", run, "--abandon", "stop"], dir);
    expect(abandoned.code).toBe(0);
    const created = await runCli(["distill", run, "--json"], dir);
    expect(created.code).toBe(0);
    expect(JSON.parse(created.stdout).files).toBeGreaterThan(0);
  });
});

test("atry distill accepts the same --run value and rejects a missing run", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-flag");
    const flagged = await runCli(["distill", "--run", run, run, "--json"], dir);
    expect(flagged.code).toBe(0);
    expect(JSON.parse(flagged.stdout).files).toBeGreaterThan(0);
  });
  await expect(takeRun(new Command(), undefined)).rejects.toThrow("run is required");
});

type Header = {
  name: string;
  id: string;
  slug: string;
  title: string;
  base: string;
  head: string | null;
  lifecycle: string;
  stage: string;
  closedAt: string | null;
  stages: { stage: string; tool: string | null; model: string | null }[];
};

async function readHeader(run: string): Promise<Header> {
  const raw = await readFile(join(run, "90-distill", "manifest.json"), "utf8");
  return (JSON.parse(raw) as { run: Header }).run;
}

async function syntheticRun(dir: string, events: object[], closed: boolean): Promise<string> {
  const run = join(dir, ".agent-relay", "20261024-1792849354-header-run");
  await mkdir(run, { recursive: true });
  const state = {
    lifecycle: closed ? "closed" : "reviewing",
    stage: "self-review",
    approved: true,
    tasks: [],
  };
  await writeFile(
    join(run, "run.json"),
    `${
      JSON.stringify({
        schema: 1,
        id: "1792849354",
        ymd: "20261024",
        slug: "header-run",
        title: "Header run",
        base: "abc",
        state,
      })
    }\n`,
  );
  await writeFile(
    join(run, "events.jsonl"),
    `${events.map((event) => JSON.stringify({ schema: 1, ...event })).join("\n")}\n`,
  );
  return run;
}

test("atry distill writes the run header with every round and a null head outside git", async () => {
  await withTempDir(async (dir) => {
    const events = [
      { ts: "2026-10-24T01:00:00Z", stage: "plan", action: "started", tool: "cursor" },
      {
        ts: "2026-10-24T02:00:00Z",
        stage: "self-review",
        action: "started",
        tool: "codex",
        model: "m1",
      },
      { ts: "2026-10-24T03:00:00Z", stage: "self-review", action: "started", tool: "codex" },
    ];
    const open = await syntheticRun(dir, events, false);
    const before = await readFile(join(open, "events.jsonl"));
    await distillRun(open);
    const header = await readHeader(open);
    expect(header).toEqual({
      name: "20261024-1792849354-header-run",
      id: "1792849354",
      slug: "header-run",
      title: "Header run",
      base: "abc",
      head: null,
      lifecycle: "reviewing",
      stage: "self-review",
      closedAt: null,
      stages: [
        { stage: "plan", tool: "cursor", model: null },
        { stage: "self-review", tool: "codex", model: "m1" },
        { stage: "self-review", tool: "codex", model: null },
      ],
    });
    expect(header.stages.filter((entry) => entry.stage === "self-review")).toHaveLength(2);
    expect(await readFile(join(open, "events.jsonl"))).toEqual(before);

    const done = await syntheticRun(
      dir,
      [...events, { ts: "2026-10-24T04:00:00Z", stage: "run", action: "closed" }],
      true,
    );
    await distillRun(done);
    expect((await readHeader(done)).closedAt).toBe("2026-10-24T04:00:00Z");
    expect((await readHeader(done)).lifecycle).toBe("closed");
  });
});

test("atry distill sets head from git and verify accepts a manifest without run", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-head");
    await distillRun(run);
    const header = await readHeader(run);
    expect(header.head).toMatch(/^[0-9a-f]{40,64}$/);
    expect(header.closedAt).toBeNull();
    const path = join(run, "90-distill", "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    delete manifest.run;
    await writeFile(path, `${JSON.stringify(manifest)}\n`);
    expect((await verifyDistill(run)).ok).toBe(true);
  });
});

test("atry distill reads head from run.worktree.path when it is set", async () => {
  await withTempDir(async (dir) => {
    const run = await syntheticRun(dir, [
      { ts: "2026-10-24T01:00:00Z", stage: "plan", action: "started", tool: "cursor" },
    ], false);
    await withTempGitRepo(async (repo) => {
      await gitCommit(repo);
      const path = join(run, "run.json");
      const json = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      json.worktree = { path: repo, branch: "work" };
      await writeFile(path, `${JSON.stringify(json)}\n`);
      await distillRun(run);
      expect((await readHeader(run)).head).toMatch(/^[0-9a-f]{40,64}$/);
    });
  });
});

test("atry distill labels each file and anchors the manifest to the last event", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-anchor");
    await distillRun(run);
    const manifest = JSON.parse(
      await readFile(join(run, "90-distill", "manifest.json"), "utf8"),
    ) as {
      atEvent: { count: number; sha256: string };
      files: { path: string; kind: string; stage?: string; task?: string }[];
    };
    for (const file of manifest.files) {
      const { path, kind, stage, task } = file;
      expect({ kind, stage, task }).toEqual({
        stage: undefined,
        task: undefined,
        ...labelPath(path),
      });
    }
    expect(manifest.files.some((file) => file.kind === "events")).toBe(true);
    const lines = (await readFile(join(run, "events.jsonl"), "utf8")).trimEnd().split("\n");
    expect(manifest.atEvent).toEqual({ count: lines.length, sha256: lineHash(lines.at(-1) ?? "") });
  });
});

test("atry distill anchors an empty event log to the hash of the empty line", async () => {
  await withTempDir(async (dir) => {
    const run = await syntheticRun(dir, [], false);
    await writeFile(join(run, "events.jsonl"), "");
    await distillRun(run);
    const manifest = JSON.parse(
      await readFile(join(run, "90-distill", "manifest.json"), "utf8"),
    ) as { atEvent: { count: number; sha256: string } };
    expect(manifest.atEvent).toEqual({ count: 0, sha256: lineHash("") });
    expect((await verifyDistill(run)).stale).toEqual([]);
    await writeFile(
      join(run, "events.jsonl"),
      `${
        JSON.stringify({ schema: 1, ts: "2026-10-24T01:00:00Z", stage: "plan", action: "started" })
      }\n`,
    );
    const stale = await verifyDistill(run);
    expect(stale.stale).toEqual(["events.jsonl"]);
    expect(stale.newEvents).toBe(1);
  });
});
