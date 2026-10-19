import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "scripts", "maint"), { recursive: true });
    await mkdir(join(root, "test"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "src", "cli.ts"), "export const value = 1;\n");
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
      "tsup.config.ts",
      "vitest.config.ts",
    ]);
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
        branchMap: { "0": { locations: [span(2), span(2)] } },
        b: { "0": [1, 0] },
        fnMap: { "0": { name: "run", loc: span(2) } },
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
    ]);
    const cliMetrics = report.files.find((file) => file.path === "src/cli.ts");
    expect(cliMetrics?.statements).toBe(50);
    expect(cliMetrics?.branches).toBe(50);
    expect(cliMetrics?.functions).toBe(0);
    expect(summaryText(report)).toContain(
      "src/cli.ts lines=50 statements=50 branches=50 functions=0",
    );
    const lcov = lcovFromCoverage(root, coverage);
    expect(lcov).toContain("SF:src/cli.ts\n");
    expect(lcov).toContain("DA:1,1\n");
    expect(lcov).toContain("DA:2,0\n");
    expect(lcov).toContain("BRDA:2,0,0,1\n");
    expect(lcov).toContain("BRDA:2,0,1,0\n");
    expect(lcov).toContain("FNDA:0,run\n");
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
  });
});
