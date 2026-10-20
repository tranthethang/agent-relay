import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import {
  assertCoverageBars,
  assertDuplication,
  buildReport,
  lcovFromCoverage,
  listSourceFiles,
  summaryText,
} from "../scripts/maint/coverage-report.ts";
import { withTempDir } from "./helper.js";

const sourceMap = JSON.stringify({
  version: 3,
  file: "atry.js",
  sources: ["../src/cli.ts"],
  names: [],
  mappings: "AAAA",
});

test("listSourceFiles keeps each handwritten TypeScript file once", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "src", "core"), { recursive: true });
    await mkdir(join(root, "scripts", "maint"), { recursive: true });
    await mkdir(join(root, "test"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "src", "cli.ts"), "export const value = 1;\n");
    await writeFile(join(root, "src", "core", "test.ts"), "export const nested = 1;\n");
    await writeFile(join(root, "src", "ignored.test.ts"), "export const ignore = 1;\n");
    await writeFile(
      join(root, "scripts", "maint", "sync-references.ts"),
      "export const sync = 1;\n",
    );
    await writeFile(join(root, "test", "cli.test.ts"), "export const skipped = 1;\n");
    await writeFile(join(root, "dist", "atry.js"), "export const bundle = 1;\n");
    await writeFile(join(root, "tsup.config.ts"), "export default {};\n");
    await writeFile(join(root, "vitest.config.ts"), "export default {};\n");
    expect(await listSourceFiles(root)).toEqual([
      "scripts/maint/sync-references.ts",
      "src/cli.ts",
      "src/core/test.ts",
      "tsup.config.ts",
      "vitest.config.ts",
    ]);
  });
  await withTempDir(async (empty) => {
    expect(await listSourceFiles(empty)).toEqual([]);
  });
});

test("buildReport attributes the bundle and keeps an uncovered branch visible", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "scripts", "maint"), { recursive: true });
    const cli = join(root, "src", "cli.ts");
    const version = join(root, "src", "version.ts");
    const script = join(root, "scripts", "maint", "sync-references.ts");
    await writeFile(cli, "export const value = 1;\nexport const other = 2;\n");
    await writeFile(version, "export const version = 1;\n");
    await writeFile(script, "export const sync = 1;\n");
    await writeFile(join(root, "tsup.config.ts"), "export default {};\n");
    const span = (line: number) => ({
      start: { line, column: 0 },
      end: { line, column: 10 },
    });
    const covered = {
      statementMap: { "0": span(1) },
      s: { "0": 1 },
      branchMap: {},
      b: {},
      fnMap: {},
      f: {},
    };
    const coverage = {
      [cli]: {
        statementMap: { "0": span(1), "1": span(2) },
        s: { "0": 0, "1": 0 },
        branchMap: { "0": { locations: [span(1), span(2)] } },
        b: { "0": [0, 0] },
        fnMap: { "0": { name: "run", loc: span(1) } },
        f: { "0": 0 },
      },
      [version]: covered,
      [script]: covered,
      [join(root, "dist", "atry.js")]: covered,
    };
    const report = await buildReport({
      root,
      sourceMap,
      coverage,
    });
    expect(report.files.map((file) => file.path)).toEqual([
      "scripts/maint/sync-references.ts",
      "src/cli.ts",
      "src/version.ts",
      "tsup.config.ts",
    ]);
    const cliMetrics = report.files.find((file) => file.path === "src/cli.ts");
    expect(cliMetrics?.statements).toBe(50);
    expect(cliMetrics?.branches).toBe(50);
    expect(cliMetrics?.functions).toBe(100);
    expect(summaryText(report)).toContain(
      "src/cli.ts lines=50 statements=50 branches=50 functions=100",
    );
    expect(summaryText(report)).toContain(
      "tsup.config.ts lines=0 statements=0 branches=0 functions=0",
    );
    const lcov = lcovFromCoverage(root, coverage);
    expect(lcov).toContain("SF:src/cli.ts\n");
    expect(lcov).toContain("DA:1,1\n");
    expect(lcov).toContain("DA:2,0\n");
    expect(lcov).toContain("BRDA:1,0,0,1\n");
    expect(lcov).toContain("BRDA:2,0,1,0\n");
    expect(lcov).toContain("FNDA:1,run\n");
    expect(lcov).not.toContain("dist/atry.js");
  });
});

test("buildReport rejects missing subprocess coverage and a missing source map", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "cli.ts"), "export const value = 1;\n");
    await expect(buildReport({ root, coverage: {}, sourceMap })).rejects.toThrow(
      "direct coverage missing: src",
    );
    await expect(buildReport({
      root,
      coverage: {
        [join(root, "dist", "atry.js")]: {
          statementMap: { "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } },
          s: { "0": 1 },
          branchMap: {},
          b: {},
          fnMap: {},
          f: {},
        },
      },
      sourceMap: null,
    })).rejects.toThrow("source map missing: dist/atry.js.map");
    await expect(buildReport({
      root,
      coverage: {
        [join(root, "dist", "atry.js")]: {
          statementMap: { "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } },
          s: { "0": 1 },
          branchMap: {},
          b: {},
          fnMap: {},
          f: {},
        },
      },
      sourceMap: JSON.stringify({
        version: 3,
        file: "atry.js",
        sources: ["../missing.ts"],
        names: [],
        mappings: "AAAA",
      }),
    })).rejects.toThrow("source map attribution missing: dist/atry.js.map");
    await expect(buildReport({
      root,
      coverage: {
        [join(root, "dist", "atry.js")]: {
          statementMap: { "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } },
          s: { "0": 1 },
          branchMap: {},
          b: {},
          fnMap: {},
          f: {},
        },
      },
      sourceMap: JSON.stringify({
        version: 3,
        file: "atry.js",
        sources: ["../src/cli.ts"],
        names: [],
        mappings: "",
      }),
    })).rejects.toThrow("source map attribution missing: dist/atry.js.map");
  });
});

const reportScript = fileURLToPath(new URL("../scripts/maint/coverage-report.ts", import.meta.url));
let reportCase = 0;

async function runReport(cwd: string) {
  const previousArgv = process.argv;
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const previousStdout = process.stdout.write;
  const previousStderr = process.stderr.write;
  const stdout: string[] = [];
  const stderr: string[] = [];
  process.argv = [process.execPath, reportScript];
  process.chdir(cwd);
  process.exitCode = undefined;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  try {
    reportCase += 1;
    await loadReport(reportCase);
  } finally {
    process.argv = previousArgv;
    process.chdir(previousCwd);
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }
  const status = process.exitCode ?? 0;
  process.exitCode = previousExitCode;
  return { status, stdout: stdout.join(""), stderr: stderr.join("") };
}

function loadReport(id: number): Promise<unknown> {
  switch (id) {
    case 1:
      // @ts-expect-error The query reloads this CLI entry.
      return import("../scripts/maint/coverage-report.ts?cli=1");
    case 2:
      // @ts-expect-error The query reloads this CLI entry.
      return import("../scripts/maint/coverage-report.ts?cli=2");
    case 3:
      // @ts-expect-error The query reloads this CLI entry.
      return import("../scripts/maint/coverage-report.ts?cli=3");
    default:
      throw new Error(`missing coverage-report import case ${id}`);
  }
}

test("coverage-report CLI runs successfully and handles errors", async () => {
  await withTempDir(async (root) => {
    const missing = await runReport(root);
    expect(missing.status).toBe(1);
    expect(missing.stderr.length).toBeGreaterThan(0);

    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "scripts", "maint"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await mkdir(join(root, "coverage"), { recursive: true });

    await writeFile(join(root, "src", "cli.ts"), "export const a = 1;\n");
    await writeFile(join(root, "src", "other.ts"), "export const b = 1;\n");
    await writeFile(join(root, "scripts", "maint", "test.ts"), "export const c = 1;\n");

    const span = (line: number) => ({
      start: { line, column: 0 },
      end: { line, column: 10 },
    });
    const covered = {
      statementMap: { "0": span(1) },
      s: { "0": 1 },
      branchMap: {},
      b: {},
      fnMap: {},
      f: {},
    };
    const coverageFinal = {
      [join(root, "src", "cli.ts")]: covered,
      [join(root, "src", "other.ts")]: covered,
      [join(root, "scripts", "maint", "test.ts")]: covered,
      [join(root, "dist", "atry.js")]: covered,
    };
    await writeFile(join(root, "coverage", "coverage-final.json"), JSON.stringify(coverageFinal));

    const noMap = await runReport(root);
    expect(noMap.status).toBe(1);
    expect(noMap.stderr).toContain("source map missing");

    await writeFile(join(root, "dist", "atry.js.map"), sourceMap);
    const bin = await installScanner(root);
    const previousFetch = globalThis.fetch;
    const previousHost = process.env.SONAR_HOST_URL;
    const previousToken = process.env.SONAR_TOKEN;
    const previousPath = process.env.PATH;
    const previousWinPath = process.env.Path;
    const calls: string[] = [];
    const nextPath = `${bin}${delimiter}${previousPath ?? ""}`;
    process.env.PATH = nextPath;
    process.env.Path = nextPath;
    process.env.SONAR_HOST_URL = "https://sonarqube.example/";
    process.env.SONAR_TOKEN = "token";
    globalThis.fetch = mockSonarFetch(calls, [{ status: "SUCCESS" }], "1");
    try {
      const ok = await runReport(root);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("files:");
      expect(calls.some((url) => url.includes("qualitygates"))).toBe(false);
      expect(calls.some((url) => url.includes("component=agent-relay"))).toBe(true);
      expect(calls.some((url) => url.includes("duplicated_lines_density"))).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      restoreEnv("SONAR_HOST_URL", previousHost);
      restoreEnv("SONAR_TOKEN", previousToken);
      restoreEnv("PATH", previousPath);
      restoreEnv("Path", previousWinPath);
    }
  });
});

test("buildReport checks for missing subprocess routes", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "scripts", "maint"), { recursive: true });
    await writeFile(join(root, "src", "cli.ts"), "export const a = 1;\n");
    await writeFile(join(root, "src", "other.ts"), "export const b = 1;\n");
    await writeFile(join(root, "scripts", "maint", "test.ts"), "export const c = 1;\n");

    const span = (line: number) => ({
      start: { line, column: 0 },
      end: { line, column: 10 },
    });
    const covered = {
      statementMap: { "0": span(1) },
      s: { "0": 1 },
      branchMap: {},
      b: {},
      fnMap: {},
      f: {},
    };

    // Missing src/cli.ts
    const missingCli = {
      [join(root, "src", "other.ts")]: covered,
      [join(root, "scripts", "maint", "test.ts")]: covered,
    };
    await expect(buildReport({ root, coverage: missingCli, sourceMap: "{}" })).rejects.toThrow(
      "subprocess coverage missing: src/cli.ts",
    );

    // Missing scripts/maint
    const missingMaint = {
      [join(root, "src", "cli.ts")]: covered,
      [join(root, "src", "other.ts")]: covered,
    };
    await expect(buildReport({ root, coverage: missingMaint, sourceMap: "{}" })).rejects.toThrow(
      "subprocess coverage missing: scripts/maint",
    );
  });
});

test("lcovFromCoverage formats anonymous functions and branch hits", () => {
  const span = (line: number) => ({
    start: { line, column: 0 },
    end: { line, column: 10 },
  });
  const coverage = {
    "/root/src/example.ts": {
      statementMap: { "0": span(1), "1": span(2) },
      s: { "0": 1, "1": 0 },
      branchMap: { "0": { locations: [span(1), span(2)] } },
      b: { "0": [2, 0] },
      fnMap: {
        "0": { name: undefined, loc: span(1) },
        "1": { name: "foo\nbar,baz", loc: span(2) },
      },
      f: { "0": 1, "1": 0 },
    },
  };
  const lcov = lcovFromCoverage("/root", coverage);
  expect(lcov).toContain("SF:src/example.ts\n");
  expect(lcov).toContain("FN:1,anonymous_0\n");
  expect(lcov).toContain("FN:2,foo bar_baz\n");
  expect(lcov).toContain("FNDA:1,anonymous_0\n");
  expect(lcov).toContain("FNDA:0,foo bar_baz\n");
  expect(lcov).toContain("BRDA:1,0,0,2\n");
  expect(lcov).toContain("BRDA:2,0,1,0\n");

  expect(lcovFromCoverage("/root", {})).toBe("");
  const fileUrl = lcovFromCoverage("/root", {
    "file:///root/src/example.ts": {
      statementMap: { "0": span(1) },
      s: { "0": 1 },
      branchMap: {},
      b: {},
      fnMap: { "0": { name: "", loc: span(1) } },
      f: { "0": 0 },
    },
  });
  expect(fileUrl).toContain("SF:src/example.ts\n");
  expect(fileUrl).toContain("FN:1,anonymous_0\n");
});

test("lcovFromCoverage handles decl-based function spans in fnMap", () => {
  const span = (line: number) => ({
    start: { line, column: 0 },
    end: { line, column: 10 },
  });
  const coverage = {
    "/root/src/decl.ts": {
      statementMap: { "0": span(5) },
      s: { "0": 1 },
      branchMap: {},
      b: {},
      fnMap: {
        // decl is set, so lcovRecord uses fn.decl for the FN line
        "0": { name: "withDecl", decl: span(5), loc: span(6) },
        // neither decl nor loc (span falls back to undefined)
        "1": { name: "noSpan" },
      },
      f: { "0": 1, "1": 0 },
    },
  };
  const lcov = lcovFromCoverage("/root", coverage);
  expect(lcov).toContain("SF:src/decl.ts\n");
  // FN line should use decl.start.line (5), not loc.start.line (6)
  expect(lcov).toContain("FN:5,withDecl\n");
  // Function with no span gets line 0
  expect(lcov).toContain("FN:0,noSpan\n");
  expect(lcov).toContain("FNDA:1,withDecl\n");
  expect(lcov).toContain("FNDA:0,noSpan\n");
});

test("buildReport attributes absolute source-map paths on the current OS", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "scripts", "maint"), { recursive: true });
    const cli = join(root, "src", "cli.ts");
    const other = join(root, "src", "other.ts");
    const script = join(root, "scripts", "maint", "test.ts");
    await writeFile(cli, "line1\n");
    await writeFile(other, "line1\n");
    await writeFile(script, "line1\n");

    const span = (line: number) => ({
      start: { line, column: 0 },
      end: { line, column: 10 },
    });
    const covered = {
      statementMap: { "0": span(1) },
      s: { "0": 1 },
      branchMap: {},
      b: {},
      fnMap: {},
      f: {},
    };

    // Use an absolute path in the source map (like an absolute Mac/Linux path)
    const absoluteSourceMap = JSON.stringify({
      version: 3,
      file: "atry.js",
      sources: [cli], // absolute path to cli.ts
      names: [],
      mappings: "AAAA",
    });

    const coverage = {
      [cli]: covered,
      [other]: covered,
      [script]: covered,
      [join(root, "dist", "atry.js")]: covered,
    };

    const report = await buildReport({ root, sourceMap: absoluteSourceMap, coverage });
    expect(report.files.map((f) => f.path)).toContain("src/cli.ts");
  });
});

test("buildReport handles edge cases in bundle mapping, branches, and functions", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "scripts", "maint"), { recursive: true });
    const cli = join(root, "src", "cli.ts");
    const other = join(root, "src", "other.ts");
    const script = join(root, "scripts", "maint", "test.ts");
    await writeFile(cli, "line1\nline2\nline3\n");
    await writeFile(other, "line1\n");
    await writeFile(script, "line1\n");

    const span = (line: number) => ({
      start: { line, column: 0 },
      end: { line, column: 10 },
    });

    const fileCoverage = {
      statementMap: { "0": span(1), "1": span(2) },
      s: { "0": 1, "1": 0 },
      branchMap: {
        "0": { locations: undefined },
        "1": { locations: [span(3)] },
      },
      b: { "0": [], "1": [] },
      fnMap: {
        "0": { decl: span(1), name: "declaredFn" },
        "1": { decl: undefined, loc: undefined, name: "noSpanFn" },
      },
      f: { "0": 0, "1": 0 },
    };

    const bundleCoverage = {
      statementMap: {
        "0": span(1),
        "1": span(2),
      },
      s: {
        "0": 1,
        "1": 0,
        "2": 1,
      },
      branchMap: {},
      b: {},
      fnMap: {},
      f: {},
    };

    const coverage = {
      [cli]: fileCoverage,
      [other]: {
        statementMap: { "0": span(1) },
        s: { "0": 1 },
        branchMap: {},
        b: {},
        fnMap: {},
        f: {},
      },
      [script]: {
        statementMap: { "0": span(1) },
        s: { "0": 1 },
        branchMap: {},
        b: {},
        fnMap: {},
        f: {},
      },
      [join(root, "dist", "atry.js")]: bundleCoverage,
    };

    const report = await buildReport({
      root,
      sourceMap,
      coverage,
    });
    expect(report.files.length).toBe(3);
  });
});

test("assertCoverageBars fails when overall coverage is below 95", async () => {
  await withTempDir(async (root) => {
    const coverage = {
      [join(root, "src", "wide.ts")]: countedFile(1000, 949),
    };
    expect(() => assertCoverageBars(root, coverage)).toThrow(
      "overall coverage below 95%: 94.9",
    );
  });
});

test("assertCoverageBars fails when a gated file is at 90", async () => {
  await withTempDir(async (root) => {
    const coverage = {
      [join(root, "src", "low.ts")]: countedFile(10, 9),
      [join(root, "scripts", "maint", "high.ts")]: countedFile(1000, 1000),
    };
    expect(() => assertCoverageBars(root, coverage)).toThrow(
      "per-file coverage at or below 90%: src/low.ts 90",
    );
  });
});

test("assertCoverageBars counts line and branch totals for both trees", async () => {
  await withTempDir(async (root) => {
    const passing = {
      [join(root, "src", "lines.ts")]: countedFile(10, 9, 10, 10),
      [join(root, "scripts", "maint", "lines.ts")]: countedFile(1000, 1000),
      [join(root, "tsup.config.ts")]: countedFile(10, 0),
      [join(root, "src", "empty.ts")]: countedFile(0, 0, 4, 0),
    };
    expect(() => assertCoverageBars(root, passing)).not.toThrow();

    const maintLow = {
      [join(root, "src", "full.ts")]: countedFile(100, 100),
      [join(root, "scripts", "maint", "low.ts")]: countedFile(100, 90),
    };
    expect(() => assertCoverageBars(root, maintLow)).toThrow(
      "per-file coverage at or below 90%: scripts/maint/low.ts 90",
    );
  });
});

test("assertCoverageBars passes at 95 overall and above 90 per file", async () => {
  await withTempDir(async (root) => {
    expect(() => {
      assertCoverageBars(root, {
        [join(root, "src", "edge.ts")]: countedFile(1000, 901),
        [join(root, "scripts", "maint", "edge.ts")]: countedFile(980, 980),
      });
    }).not.toThrow();
  });
});

test("assertDuplication fails when the host or token is missing", async () => {
  await withTempDir(async (root) => {
    await expect(assertDuplication({ root, env: { SONAR_TOKEN: "token" } })).rejects.toThrow(
      "SONAR_HOST_URL missing",
    );
    await expect(assertDuplication({
      root,
      env: { SONAR_HOST_URL: "https://sonarqube.example", SONAR_TOKEN: "  " },
    })).rejects.toThrow("SONAR_TOKEN missing");
  });
});

test("assertDuplication fails when sonar-scanner is missing or exits non-zero", async () => {
  await withTempDir(async (root) => {
    const empty = join(root, "empty-bin");
    await mkdir(empty);
    const env = sonarEnv(empty);
    await expect(assertDuplication({ root, env })).rejects.toThrow("sonar-scanner missing");
    const bin = await installScanner(root, 1);
    await expect(assertDuplication({ root, env: sonarEnv(bin) })).rejects.toThrow(
      "sonar-scanner failed",
    );
  });
});

test("assertDuplication fails when the analysis task id is missing", async () => {
  await withTempDir(async (root) => {
    const env = { SONAR_HOST_URL: "https://sonarqube.example", SONAR_TOKEN: "token" };
    const runScanner = async () => {};
    await expect(assertDuplication({ root, env, runScanner })).rejects.toThrow(
      "analysis task id missing",
    );
    await mkdir(join(root, ".scannerwork"));
    await writeFile(join(root, ".scannerwork", "report-task.txt"), "projectKey=agent-relay\n");
    await expect(assertDuplication({ root, env, runScanner })).rejects.toThrow(
      "analysis task id missing",
    );
  });
});

test("assertDuplication fails when the analysis task does not succeed", async () => {
  await withTempDir(async (root) => {
    await expect(duplicationInput(root, [{ status: "FAILED" }]).run()).rejects.toThrow(
      "analysis task FAILED",
    );
    await expect(duplicationInput(root, [{ status: "CANCELED" }]).run()).rejects.toThrow(
      "analysis task CANCELED",
    );
    await expect(duplicationInput(root, [{ task: {} }]).run()).rejects.toThrow(
      "analysis task status missing",
    );
    await expect(duplicationInput(root, [], "1", 503).run()).rejects.toThrow(
      "sonar request failed: 503",
    );
    const slept: number[] = [];
    await expect(assertDuplication({
      root,
      env: { SONAR_HOST_URL: "https://sonarqube.example", SONAR_TOKEN: "token" },
      runScanner: async () => {},
      readTaskFile: async () => "ceTaskId=task-1\n",
      attempts: 1,
      sleep: async (ms) => {
        slept.push(ms);
      },
      fetchImpl: mockSonarFetch([], [{ status: "PENDING" }], "1"),
    })).rejects.toThrow("analysis task timed out");
    expect(slept).toEqual([1000]);
  });
});

test("assertDuplication waits with the default pause", async () => {
  vi.useFakeTimers();
  try {
    const run = assertDuplication({
      root: "/tmp/coverage-bars",
      env: { SONAR_HOST_URL: "https://sonarqube.example", SONAR_TOKEN: "token" },
      runScanner: async () => {},
      readTaskFile: async () => "ceTaskId=task-1\n",
      attempts: 1,
      fetchImpl: mockSonarFetch([], [{ status: "PENDING" }], "1"),
    });
    const assertion = expect(run).rejects.toThrow("analysis task timed out");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});

test("assertDuplication reads duplicated lines density and ignores the quality gate", async () => {
  await withTempDir(async (root) => {
    const pending = duplicationInput(root, [{ status: "IN_PROGRESS" }, { status: "SUCCESS" }], "1");
    await expect(pending.run()).resolves.toBeUndefined();
    expect(pending.calls.some((url) => url.includes("qualitygates"))).toBe(false);
    expect(pending.calls.some((url) => url.includes("/api/ce/task?id=task-1"))).toBe(true);
    await expect(duplicationInput(root, [{ status: "SUCCESS" }], "1.1").run()).rejects.toThrow(
      "duplicated lines density above 1%: 1.1",
    );
    await expect(duplicationInput(root, [{ status: "SUCCESS" }], null).run()).rejects.toThrow(
      "duplicated lines density missing",
    );
    await expect(duplicationInput(root, [{ status: "SUCCESS" }], "nope").run()).rejects.toThrow(
      "duplicated lines density missing",
    );
    await expect(assertDuplication({
      root,
      env: { SONAR_HOST_URL: "https://sonarqube.example", SONAR_TOKEN: "token" },
      runScanner: async () => {},
      readTaskFile: async () => "ceTaskId=task-1\n",
      sleep: async () => {},
      fetchImpl: (async (url: RequestInfo | URL) => {
        if (String(url).includes("/api/ce/task")) {
          return Response.json({ task: { status: "SUCCESS" } });
        }
        return Response.json({
          component: { measures: [null, { metric: "duplicated_lines_density", value: 1 }] },
        });
      }) as typeof fetch,
    })).rejects.toThrow("duplicated lines density missing");
  });
});

function countedFile(lines: number, coveredLines: number, branches = 0, coveredBranches = 0) {
  const statementMap: Record<string, Span> = {};
  const statements: Record<string, number> = {};
  for (let line = 1; line <= lines; line += 1) {
    statementMap[String(line)] = {
      start: { line, column: 0 },
      end: { line, column: 1 },
    };
    statements[String(line)] = line <= coveredLines ? 1 : 0;
  }
  const locations = Array.from({ length: branches }, (_, index) => ({
    start: { line: 1, column: index },
    end: { line: 1, column: index + 1 },
  }));
  const counts = Array.from({ length: branches }, (_, index) => (index < coveredBranches ? 1 : 0));
  const branchMap: Record<string, { locations: Span[] }> = {};
  const branchCounts: Record<string, number[]> = {};
  if (branches > 0) {
    branchMap["0"] = { locations };
    branchCounts["0"] = counts;
  }
  return {
    statementMap,
    s: statements,
    branchMap,
    b: branchCounts,
    fnMap: {},
    f: {},
  };
}

type Span = { start: { line: number; column: number }; end: { line: number; column: number } };

function sonarEnv(bin: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: bin,
    Path: bin,
    SONAR_HOST_URL: "https://sonarqube.example",
    SONAR_TOKEN: "token",
  };
}

async function installScanner(root: string, exitCode = 0): Promise<string> {
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  const script = join(bin, "scanner.mjs");
  const source = exitCode === 0
    ? [
      "import { mkdir, writeFile } from \"node:fs/promises\";",
      "await mkdir(\".scannerwork\", { recursive: true });",
      "await writeFile(\".scannerwork/report-task.txt\", \"projectKey=agent-relay\\nceTaskId=task-1\\n\");",
      "",
    ].join("\n")
    : `process.exit(${exitCode});\n`;
  await writeFile(script, source);
  if (process.platform === "win32") {
    await writeFile(
      join(bin, "sonar-scanner.cmd"),
      `@echo off\r\n"${process.execPath}" "${script}"\r\n`,
    );
    return bin;
  }
  const command = join(bin, "sonar-scanner");
  await writeFile(command, `#!/bin/sh\nexec "${process.execPath}" "${script}"\n`, { mode: 0o755 });
  await chmod(command, 0o755);
  return bin;
}

function restoreEnv(
  name: "SONAR_HOST_URL" | "SONAR_TOKEN" | "PATH" | "Path",
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function mockSonarFetch(
  calls: string[],
  tasks: Array<{ status?: string; task?: Record<string, unknown> }>,
  density: string | null,
  statusCode = 200,
): typeof fetch {
  let taskIndex = 0;
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push(href);
    if (statusCode !== 200) return new Response("nope", { status: statusCode });
    const header = new Headers(init?.headers).get("authorization") ?? "";
    if (!header.startsWith("Basic ")) return new Response("unauthorized", { status: 401 });
    if (href.includes("/api/ce/task")) {
      const task = tasks[taskIndex] ?? tasks.at(-1);
      taskIndex += 1;
      if (task?.status === undefined) return Response.json({ task: task?.task ?? {} });
      return Response.json({ task: { id: "task-1", status: task.status } });
    }
    if (density === null) return Response.json({ component: { measures: [] } });
    return Response.json({
      component: {
        key: "agent-relay",
        measures: [{ metric: "duplicated_lines_density", value: density }],
      },
    });
  }) as typeof fetch;
}

function duplicationInput(
  root: string,
  tasks: Array<{ status?: string; task?: Record<string, unknown> }> = [{ status: "SUCCESS" }],
  density: string | null = "1",
  statusCode = 200,
) {
  const calls: string[] = [];
  return {
    calls,
    run: () =>
      assertDuplication({
        root,
        env: { SONAR_HOST_URL: "https://sonarqube.example", SONAR_TOKEN: "token" },
        runScanner: async () => {},
        readTaskFile: async () => "projectKey=agent-relay\nceTaskId=task-1\n",
        fetchImpl: mockSonarFetch(calls, tasks, density, statusCode),
        sleep: async () => {},
        attempts: tasks.length === 0 ? 1 : tasks.length,
      }),
  };
}
