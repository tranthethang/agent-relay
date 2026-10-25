import { spawnSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadScenarios } from "../evals/model/fixtures.js";
import { buildReport, type Row, toMarkdown } from "../evals/model/report.js";
import { parseArgs, runModelEvals } from "../evals/model/run.js";
import type { Runner } from "../evals/model/runners.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function outDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "atry-report-"));
  dirs.push(dir);
  return dir;
}

function row(tool: string, status: Row["status"], scenario = "s"): Row {
  return { tool, scenario, repeat: 1, status, matched: 1, required: 2, ms: 1500, reason: "a|b" };
}

// A fake agent: appends the given events to the run in the fixture, or creates one.
function fakeRunner(
  events: string[],
  options: { available?: boolean; timedOut?: boolean } = {},
): Runner {
  return {
    tool: "claude-code",
    available: () => options.available ?? true,
    run: async (_prompt, cwd) => {
      if (events.length > 0) {
        const root = join(cwd, ".agent-relay");
        await mkdir(join(root, "20261025-1-fake"), { recursive: true });
        const lines = events.map((e) =>
          JSON.stringify({ stage: e.split(":")[0], action: e.split(":")[1] })
        );
        await appendFile(join(root, "20261025-1-fake", "events.jsonl"), `${lines.join("\n")}\n`);
      }
      return { exit: 0, timedOut: options.timedOut ?? false, ms: 10 };
    },
  };
}

test("the rate counts skipped rows apart from ran", () => {
  const report = buildReport(
    [row("a", "pass"), row("a", "fail"), row("a", "skipped"), row("b", "skipped")],
    "d",
  );
  expect(report.rate).toEqual({
    a: { passed: 1, ran: 2, skipped: 1 },
    b: { passed: 0, ran: 0, skipped: 1 },
  });
});

test("the markdown has a table row per result and a rate line per tool", () => {
  const md = toMarkdown(
    buildReport([row("a", "pass"), row("a", "fail"), row("b", "skipped")], "d"),
  );
  expect(md).toContain("| a | s | 1 | pass | 1/2 | 1.5 | a\\|b |");
  expect(md).toContain("- a: 1/2 scenarios passed (50%), 0 skipped");
  expect(md).toContain("- b: 0/0 scenarios passed (n/a), 1 skipped");
});

test("a fake runner that writes the expected events passes, and a forbidden event fails", async () => {
  const scenarios = (await loadScenarios()).filter((s) => s.name === "plan-small");
  const pass = await runModelEvals({
    runners: [fakeRunner(["run:created", "plan:started", "plan:completed"])],
    scenarios,
    repeat: 1,
    outDir: await outDir(),
  });
  expect(pass.rows[0]).toMatchObject({ status: "pass", matched: 3, required: 3, reason: "" });

  const out = await outDir();
  const fail = await runModelEvals({
    runners: [fakeRunner(["run:created", "plan:started", "plan:completed", "plan:approved"])],
    scenarios,
    repeat: 1,
    outDir: out,
  });
  expect(fail.rows[0]).toMatchObject({ status: "fail", matched: 3 });
  expect(fail.rows[0].reason).toContain("forbidden plan:approved");
  expect(JSON.parse(await readFile(join(out, "report.json"), "utf8")).rate).toEqual({
    "claude-code": { passed: 0, ran: 1, skipped: 0 },
  });
  expect(await readFile(join(out, "report.md"), "utf8")).toContain("plan-small");
  expect(await readFile(join(out, "events", "claude-code", "plan-small-1.jsonl"), "utf8"))
    .toContain("approved");
});

test("a partial run, a timeout, and a dirty tree each fail with a reason", async () => {
  const all = await loadScenarios();
  const partial = await runModelEvals({
    runners: [fakeRunner(["run:created", "plan:started"], { timedOut: true })],
    scenarios: all.filter((s) => s.name === "plan-small"),
    repeat: 1,
    outDir: await outDir(),
  });
  expect(partial.rows[0]).toMatchObject({ status: "fail", matched: 2 });
  expect(partial.rows[0].reason).toBe("timeout; missing plan:completed");

  const dirty: Runner = {
    ...fakeRunner([]),
    run: async (_p, cwd) => {
      await writeFile(join(cwd, "README.md"), "changed\n");
      return { exit: 0, timedOut: false, ms: 1 };
    },
  };
  const brainstorm = await runModelEvals({
    runners: [dirty],
    scenarios: all.filter((s) => s.name === "brainstorm-readonly"),
    repeat: 1,
    outDir: await outDir(),
  });
  expect(brainstorm.rows[0].status).toBe("fail");
  expect(brainstorm.rows[0].reason).toContain("tree is not clean");
});

test("an unavailable runner gives skipped rows for every repeat, and a throwing runner fails", async () => {
  const scenarios = (await loadScenarios()).filter((s) => s.name === "brainstorm-readonly");
  const skipped = await runModelEvals({
    runners: [fakeRunner([], { available: false })],
    scenarios,
    repeat: 2,
    outDir: await outDir(),
  });
  expect(skipped.rows.map((r) => r.status)).toEqual(["skipped", "skipped"]);
  expect(skipped.rate["claude-code"]).toEqual({ passed: 0, ran: 0, skipped: 2 });

  const broken: Runner = {
    ...fakeRunner([]),
    run: () => Promise.reject(new Error("install failed")),
  };
  const failed = await runModelEvals({
    runners: [broken],
    scenarios,
    repeat: 1,
    outDir: await outDir(),
  });
  expect(failed.rows[0]).toMatchObject({ status: "fail", reason: "install failed" });
});

test("parseArgs reads repeatable flags and rejects bad input", () => {
  expect(
    parseArgs([
      "--tool",
      "codex",
      "--tool",
      "claude-code",
      "--scenario",
      "x",
      "--repeat",
      "3",
      "--out",
      "o",
    ]),
  )
    .toEqual({ tools: ["codex", "claude-code"], scenarios: ["x"], repeat: 3, out: "o" });
  expect(() => parseArgs(["--bogus", "1"])).toThrow(/unknown argument/);
  expect(() => parseArgs(["--tool"])).toThrow(/needs a value/);
  expect(() => parseArgs(["--repeat", "0"])).toThrow(/positive integer/);
});

function cli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "evals/model/run.ts", ...args],
    { cwd: join(import.meta.dirname, ".."), env, encoding: "utf8" },
  );
}

test("with no API key set the entry point prints every row as skipped and exits 0", async () => {
  const out = await outDir();
  const result = cli(["--out", out], { PATH: process.env.PATH });
  expect(result.status, result.stderr).toBe(0);
  const rows = result.stdout.split("\n").filter((l) =>
    l.startsWith("| claude-code") || l.startsWith("| codex")
  );
  expect(rows).toHaveLength(8);
  expect(rows.every((l) => l.includes("| skipped |"))).toBe(true);
  expect(JSON.parse(await readFile(join(out, "report.json"), "utf8")).rows).toHaveLength(8);
});

test("a usage error exits 2", () => {
  expect(cli(["--scenario", "nope"], { PATH: process.env.PATH }).status).toBe(2);
  expect(cli(["--tool", "nope"], { PATH: process.env.PATH }).status).toBe(2);
  expect(cli(["--repeat", "x"], { PATH: process.env.PATH }).status).toBe(2);
});
