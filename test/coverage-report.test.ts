import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
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
      return import("../scripts/maint/coverage-report.ts?cli=1");
    case 2:
      return import("../scripts/maint/coverage-report.ts?cli=2");
    case 3:
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
    const ok = await runReport(root);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("files:");
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
