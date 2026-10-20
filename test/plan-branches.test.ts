import { execFile } from "node:child_process";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, vi } from "vitest";
import {
  assertDuplication,
  buildReport,
  isMissingScanner,
  lcovFromCoverage,
  listSourceFiles,
  scannerName,
} from "../scripts/maint/coverage-report.ts";
import {
  indexFromTasks,
  planAmend,
  planDone,
  planDoneText,
  planNew,
  taskDone,
  taskMoveText,
  taskSkip,
  taskStart,
} from "../src/core/plan.js";
import { gitCommit, withTempDir, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

const execFileAsync = promisify(execFile);

const overlapHooks = vi.hoisted(() => ({ throwPlain: false }));

vi.mock("../src/core/overlap.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/overlap.js")>();
  return {
    ...real,
    normalizePath: (input: string) => {
      if (overlapHooks.throwPlain) throw new TypeError("plain failure");
      return real.normalizePath(input);
    },
  };
});

type Coverage = Parameters<typeof buildReport>[0]["coverage"];

type Span = { start: { line: number; column: number }; end: { line: number; column: number } };

const span = (line: number): Span => ({
  start: { line, column: 0 },
  end: { line, column: 10 },
});

const sourceMap = JSON.stringify({
  version: 3,
  file: "atry.js",
  sources: ["../src/cli.ts"],
  names: [],
  mappings: "AAAA",
});

async function rawEvent(run: string, fields: Record<string, unknown>): Promise<void> {
  const line = { schema: 1, ts: "2026-10-20T00:00:00.000Z", ...fields };
  await appendFile(join(run, "events.jsonl"), `${JSON.stringify(line)}\n`);
}

test("planDoneText prints none for an empty task list", () => {
  expect(planDoneText({ schema: 1, path: "/run", tasks: [], index: "/run/index.json" }))
    .toBe("tasks: none\nindex: /run/index.json\n");
});

test("plan text helpers print tasks, warnings, and reasons", () => {
  expect(planDoneText({ schema: 1, path: "/r", tasks: ["T1", "T2"], index: "/i", warning: "w" }))
    .toBe("tasks: T1, T2\nindex: /i\nwarning: w\n");
  const move = { schema: 1 as const, path: "/r", task: "T1", status: "done" as const };
  expect(taskMoveText({ ...move, implement: "/m" })).toBe(
    "task: T1\nstatus: done\nimplement: /m\n",
  );
  expect(taskMoveText({ ...move, implement: "/m", reason: "why" })).toContain("reason: why\n");
});

test("indexFromTasks rejects bad ids, duplicates, unknown deps, cycles, and forward deps", () => {
  const task = (deps: string[] = []) => ({ title: "t", deps, files: [] });
  const nine = Array.from({ length: 9 }, () => task());
  expect(() => indexFromTasks(nine)).toThrow("plan has more than 8 tasks");
  expect(indexFromTasks(nine, undefined, false).tasks).toHaveLength(9);
  expect(() => indexFromTasks([task()], [])).toThrow("invalid task id");
  expect(() => indexFromTasks([task()], ["bad"])).toThrow("invalid task id");
  expect(() => indexFromTasks([task(), task()], ["T1", "T1"])).toThrow("duplicate task id");
  expect(() => indexFromTasks([task(["T9"])])).toThrow("unknown id T9");
  expect(() => indexFromTasks([task(["T2"]), task(["T1"])])).toThrow("cycle T1 T2");
  expect(() => indexFromTasks([task(["T1"])])).toThrow("cycle T1");
  expect(() => indexFromTasks([task(["T2"]), task()])).toThrow("forward dep T2");
  expect(indexFromTasks([task(), task(["T1"]), task(["T1", "T2"])]).tasks).toHaveLength(3);
});

test("plan new refuses existing plan files", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-new");
    await rm(join(run, "10-plan", "overview.md"), { force: true });
    await rm(join(run, "10-plan", "tasks.input.json"), { force: true });
    const created = await planNew(run);
    expect(created.overview).toBe(join(run, "10-plan", "overview.md"));
    await expect(planNew(run)).rejects.toThrow("already exists");
    await rm(created.overview);
    await expect(planNew(run)).rejects.toThrow("already exists");
  });
});

test("non-strict plans warn above eight tasks and accept outside edits", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-loose");
    const nine = Array.from({ length: 9 }, (_, index) => ({
      title: `Task ${index + 1}`,
      files: [`f${index + 1}.txt`],
      deps: index === 1 ? ["T1"] : [],
    }));
    await writeTasks(run, nine);
    expect((await planDone(run)).warning).toContain("strict.plan=false");
    await startImplement(dir, run);

    await expect(taskStart(run, "T2")).rejects.toThrow("task start refused: T1 is pending");
    await expect(taskDone(run, "T3")).rejects.toThrow("task done refused: T3 is pending");
    await taskStart(run, "T3");
    await taskStart(run, "T4");
    await taskStart(run, "T5");
    await taskDone(run, "T5");
    await rawEvent(run, { stage: "implement", action: "claimed", task: "T3", session: "s3" });
    await writeFile(join(dir, "outside.txt"), "x\n");
    const loose = await taskDone(run, "T3", "s3");
    expect(loose.reason).toContain("strict.scope=false (outside.txt)");
    const skipped = await taskSkip(run, "T4", "drop");
    expect(skipped).toMatchObject({ status: "skipped", reason: "drop" });

    await taskStart(run, "T1");
    await writeTasks(run, [
      ...nine.slice(0, 8),
      { title: "Task 9", files: ["f9.txt"], deps: [] },
      { title: "Added", files: [], deps: [] },
    ]);
    const amended = await planAmend(run);
    expect(amended.tasks).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"]);
    expect(amended.warning).toContain("plan has 10 tasks");

    await writeTasks(run, nine.slice(1, 9));
    await expect(planAmend(run)).rejects.toThrow("plan amend refused: T1 has started");
  });
});

test("strict plan amend renumbers past dropped plan files", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self", "cross"],
        smallChange: 20,
        strict: { plan: true },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir);
    const run = await createRun(dir, "plan-strict");
    await writeTasks(run, [{ title: "A" }, { title: "B" }]);
    expect((await planDone(run)).warning).toBeUndefined();
    await expect(taskStart(run, "T1")).rejects.toThrow("task start refused: run is planned");
    await writeTasks(run, [{ title: "A" }, { title: "C" }]);
    const amended = await planAmend(run);
    expect(amended.tasks).toEqual(["T1", "T3"]);
    expect(amended.warning).toBeUndefined();
  });
});

test("plan done refuses a run with a started task", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-started");
    await writeTasks(run, [{ title: "First" }]);
    await rawEvent(run, { stage: "implement", action: "task-started", task: "T1" });
    await expect(planDone(run)).rejects.toThrow("plan done refused: T1 has started");
  });
});

test("plan done rethrows a non-relay path failure", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "plan-plain");
    await writeTasks(run, [{ title: "First", files: ["src/a.ts"] }]);
    overlapHooks.throwPlain = true;
    try {
      await expect(planDone(run)).rejects.toThrow(TypeError);
    } finally {
      overlapHooks.throwPlain = false;
    }
    await writeTasks(run, [{ title: "First", files: ["/abs.ts"] }]);
    await expect(planDone(run)).rejects.toThrow("path leaves the repo");
  });
});

test("task verbs refuse bad states and a missing start tree", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self", "cross"],
        smallChange: 20,
        strict: { scope: true },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir);
    const run = await createRun(dir, "task-gates");
    await writeTasks(run, [
      { title: "First", files: ["a.txt"] },
      { title: "Second", files: ["b.txt"] },
      { title: "Third", files: ["c.txt"] },
    ]);
    expect((await planDone(run)).tasks).toEqual(["T1", "T2", "T3"]);
    await startImplement(dir, run);

    await expect(taskSkip(run, "T1", "   ")).rejects.toThrow("reason is empty");
    expect((await taskStart(run, "T1")).status).toBe("in-progress");
    await expect(taskStart(run, "T1")).rejects.toThrow("task start refused: T1 is in-progress");

    await writeFile(join(dir, "outside.txt"), "x\n");
    await expect(taskDone(run, "T1")).rejects.toThrow("has edits outside its files: outside.txt");
    await expect(taskDone(run, "T1", undefined, "  ")).rejects.toThrow("reason is empty");
    const done = await taskDone(run, "T1", undefined, "shared file");
    expect(done.reason).toBe("shared file");
    await expect(taskSkip(run, "T1", "late")).rejects.toThrow("task skip refused: T1 is done");

    await rawEvent(run, { stage: "implement", action: "task-started", task: "T2" });
    await rawEvent(run, { stage: "implement", action: "stolen", task: "T2", session: "s1" });
    await expect(taskDone(run, "T2", "s1")).rejects.toThrow(
      "task done refused: T2 has no start tree",
    );
  });
});

test("plan amend refuses a started task whose deps change to a same-size set", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "amend-deps");
    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third", deps: ["T1"] },
    ]);
    await planDone(run);
    await startImplement(dir, run);
    await taskStart(run, "T1");
    await taskDone(run, "T1");
    await taskStart(run, "T3");
    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third", deps: ["T1"] },
    ]);
    expect((await planAmend(run)).tasks).toEqual(["T1", "T2", "T3"]);
    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third", deps: ["T1", "T2"] },
    ]);
    await expect(planAmend(run)).rejects.toThrow("plan amend refused: T3 has started");
    await writeTasks(run, [
      { title: "First" },
      { title: "Second" },
      { title: "Third", deps: ["T2"] },
    ]);
    await expect(planAmend(run)).rejects.toThrow("plan amend refused: T3 has started");
  });
});

test("scannerName picks the Windows command on win32 only", () => {
  expect(scannerName("win32")).toBe("sonar-scanner.cmd");
  expect(scannerName("linux")).toBe("sonar-scanner");
  expect(scannerName("darwin")).toBe("sonar-scanner");
  expect(["sonar-scanner", "sonar-scanner.cmd"]).toContain(scannerName());
});

test("isMissingScanner reads codes and stderr text", () => {
  expect(isMissingScanner(null)).toBe(false);
  expect(isMissingScanner("ENOENT")).toBe(false);
  expect(isMissingScanner({ code: "ENOENT" })).toBe(true);
  expect(isMissingScanner({ code: 1 })).toBe(false);
  expect(isMissingScanner({ stderr: undefined })).toBe(false);
  expect(isMissingScanner({ stderr: "sh: sonar-scanner: command not found" })).toBe(true);
  expect(isMissingScanner({
    stderr: "'sonar-scanner' is not recognized as an internal or external command",
  })).toBe(true);
});

test("assertDuplication rejects an undefined token and non-object bodies", async () => {
  await withTempDir(async (root) => {
    await expect(assertDuplication({
      root,
      env: { SONAR_HOST_URL: "https://sonarqube.example" },
    })).rejects.toThrow("SONAR_TOKEN missing");
    const base = {
      root,
      env: { SONAR_HOST_URL: "https://sonarqube.example", SONAR_TOKEN: "token" },
      runScanner: async () => {},
      readTaskFile: async () => "ceTaskId=task-1\n",
      sleep: async () => {},
    };
    await expect(assertDuplication({
      ...base,
      fetchImpl: (async () => Response.json(null)) as typeof fetch,
    })).rejects.toThrow("analysis task status missing");
    await expect(assertDuplication({
      ...base,
      fetchImpl: (async (url: RequestInfo | URL) => {
        if (String(url).includes("/api/ce/task")) {
          return Response.json({ task: { status: "SUCCESS" } });
        }
        return Response.json("text");
      }) as typeof fetch,
    })).rejects.toThrow("duplicated lines density missing");
  });
});

test("listSourceFiles skips files that are not TypeScript", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "cli.ts"), "x\n");
    await writeFile(join(root, "src", "notes.md"), "x\n");
    expect(await listSourceFiles(root)).toEqual(["src/cli.ts"]);
  });
});

test("buildReport fails when the bundle hits no mapped statement", async () => {
  await withTempDir(async (root) => {
    const cli = join(root, "src", "cli.ts");
    const coverage = {
      [cli]: {
        statementMap: { "0": span(5) },
        s: { "0": 0 },
        branchMap: {},
        b: {},
        fnMap: {},
        f: {},
      },
      [join(root, "dist", "atry.js")]: {
        statementMap: { "0": span(1) },
        s: { "0": 1 },
        branchMap: {},
        b: {},
        fnMap: {},
        f: {},
      },
    };
    await expect(buildReport({ root, coverage, sourceMap })).rejects.toThrow(
      "source map attribution missing",
    );
  });
});

test("buildReport fills sparse hit maps from the bundle", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "scripts", "maint"), { recursive: true });
    for (const file of ["src/zero.ts", "src/cli.ts", "src/other.ts", "scripts/maint/x.ts"]) {
      await writeFile(join(root, file), "x\n");
    }
    const hit = {
      statementMap: { "0": span(1) },
      s: { "0": 1 },
      branchMap: {},
      b: {},
      fnMap: {},
      f: {},
    };
    const coverage: Coverage = {
      [join(root, "src", "zero.ts")]: {
        statementMap: { "0": span(1), "1": span(2) },
        s: { "0": 0 },
        branchMap: {},
        b: {},
        fnMap: {},
        f: {},
      },
      [join(root, "src", "cli.ts")]: {
        statementMap: { "0": span(1) },
        s: {},
        branchMap: { "0": { locations: [span(1), span(9)] } },
        b: {},
        fnMap: { "0": { loc: span(1) } },
        f: {},
      },
      [join(root, "src", "other.ts")]: hit,
      [join(root, "scripts", "maint", "x.ts")]: hit,
      [join(root, "dist", "atry.js")]: hit,
    };
    const report = await buildReport({ root, coverage, sourceMap });
    expect(report.files.find((file) => file.path === "src/cli.ts")).toMatchObject({
      lines: 100,
      branches: 100,
      functions: 100,
    });
    expect(report.files.find((file) => file.path === "src/zero.ts")?.lines).toBe(0);
  });
});

test("lcovFromCoverage treats missing hit counts as zero", () => {
  const root = join("/", "repo");
  const text = lcovFromCoverage(root, {
    [join(root, "src", "a.ts")]: {
      statementMap: { "0": span(1) },
      s: {},
      branchMap: { "0": {}, "1": { locations: [span(2)] } },
      b: {},
      fnMap: { "0": { name: "named", loc: span(1) } },
      f: {},
    },
  });
  expect(text).toContain("FNDA:0,named");
  expect(text).toContain("BRDA:2,1,0,0");
  expect(text).toContain("DA:1,0");
  expect(text).toContain("BRF:1");
});
