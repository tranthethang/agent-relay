// Per-file coverage report for handwritten TypeScript.
// Usage:
//   node --experimental-strip-types scripts/maint/coverage-report.ts

import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type FileMetrics = {
  path: string;
  lines: number;
  statements: number;
  branches: number;
  functions: number;
};

export type CoverageReport = {
  schema: 1;
  files: FileMetrics[];
};

type Loc = { line: number; column: number };
type Span = { start: Loc; end: Loc };

type IstanbulFn = { name?: string; decl?: Span; loc?: Span };

type IstanbulFile = {
  statementMap: Record<string, Span>;
  s: Record<string, number>;
  branchMap: Record<string, { locations?: Span[] }>;
  b: Record<string, number[]>;
  fnMap: Record<string, IstanbulFn>;
  f: Record<string, number>;
};

const sourceDirs = ["src", "scripts/maint"];
const sourceFiles = ["tsup.config.ts", "vitest.config.ts"];

export async function listSourceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const dir of sourceDirs) {
    await walk(resolve(root, dir), root, found);
  }
  for (const file of sourceFiles) {
    try {
      await readFile(resolve(root, file));
      found.push(file);
    } catch {
      // A config file is absent in a fixture.
    }
  }
  found.sort((left, right) => left.localeCompare(right));
  const unique = new Set(found);
  if (unique.size !== found.length) {
    throw new Error("source inventory lists a file more than once");
  }
  return found;
}

export async function buildReport(input: {
  root: string;
  coverage: Record<string, IstanbulFile>;
  sourceMap: string | null;
}): Promise<CoverageReport> {
  if (input.sourceMap === null) {
    throw new Error("source map missing: dist/atry.js.map");
  }
  const files = indexByRelative(input.coverage, input.root);
  const bundle = findBundle(input.coverage, input.root);
  if (bundle !== undefined) {
    const attributed = applyBundle(files, bundle, new TraceMap(input.sourceMap), input.root);
    if (attributed.length === 0) {
      throw new Error("source map attribution missing: dist/atry.js.map");
    }
  }
  if (!hasRoute(files, (path) => path.startsWith("src/") && path !== "src/cli.ts")) {
    throw new Error("direct coverage missing: src");
  }
  if (!hasRoute(files, (path) => path === "src/cli.ts")) {
    throw new Error("subprocess coverage missing: src/cli.ts");
  }
  if (!hasRoute(files, (path) => path.startsWith("scripts/maint/"))) {
    throw new Error("subprocess coverage missing: scripts/maint");
  }
  const inventory = await listSourceFiles(input.root);
  return {
    schema: 1,
    files: inventory.map((path) => metricsFor(path, files.get(path))),
  };
}

export function lcovFromCoverage(
  root: string,
  coverage: Record<string, IstanbulFile>,
): string {
  return lcovText(indexByRelative(coverage, root));
}

export function summaryText(report: CoverageReport): string {
  const lines = [`files: ${report.files.length}`];
  for (const file of report.files) {
    lines.push(
      `${file.path} lines=${file.lines} statements=${file.statements} branches=${file.branches} functions=${file.functions}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const coveragePath = join(root, "coverage", "coverage-final.json");
  const mapPath = join(root, "dist", "atry.js.map");
  const coverage = JSON.parse(await readFile(coveragePath, "utf8")) as Record<string, IstanbulFile>;
  let sourceMap: string | null = null;
  try {
    sourceMap = await readFile(mapPath, "utf8");
  } catch {
    sourceMap = null;
  }
  const report = await buildReport({ root, coverage, sourceMap });
  await writeFile(join(root, "coverage", "files.json"), `${JSON.stringify(report)}\n`);
  await writeFile(join(root, "coverage", "lcov.info"), lcovFromCoverage(root, coverage));
  process.stdout.write(summaryText(report));
}

function hasRoute(
  files: Map<string, IstanbulFile>,
  match: (path: string) => boolean,
): boolean {
  for (const [path, file] of files) {
    if (!match(path)) continue;
    if (Object.values(file.s).some((count) => count > 0)) return true;
  }
  return false;
}

function findBundle(
  coverage: Record<string, IstanbulFile>,
  root: string,
): IstanbulFile | undefined {
  for (const [path, file] of Object.entries(coverage)) {
    if (toRelative(root, path) === "dist/atry.js") return file;
  }
  return undefined;
}

function indexByRelative(
  coverage: Record<string, IstanbulFile>,
  root: string,
): Map<string, IstanbulFile> {
  const files = new Map<string, IstanbulFile>();
  for (const [path, file] of Object.entries(coverage)) {
    const rel = toRelative(root, path);
    if (rel === "dist/atry.js") continue;
    files.set(rel, file);
  }
  return files;
}

function applyBundle(
  files: Map<string, IstanbulFile>,
  bundle: IstanbulFile,
  traced: TraceMap,
  root: string,
): string[] {
  const attributed = new Set<string>();
  for (const [id, count] of Object.entries(bundle.s)) {
    if (count <= 0) continue;
    const span = bundle.statementMap[id];
    if (span === undefined) continue;
    const position = originalPositionFor(traced, {
      line: span.start.line,
      column: span.start.column,
    });
    if (position.source === null || position.line === null) continue;
    const rel = normalizeSource(position.source, root);
    const file = files.get(rel);
    if (file === undefined) continue;
    if (markHit(file, position.line)) attributed.add(rel);
  }
  return [...attributed];
}

function markHit(file: IstanbulFile, line: number): boolean {
  let hit = false;
  for (const [id, span] of Object.entries(file.statementMap)) {
    if (!containsLine(span, line)) continue;
    file.s[id] = Math.max(file.s[id] ?? 0, 1);
    hit = true;
  }
  for (const [id, fn] of Object.entries(file.fnMap)) {
    const span = fn.decl ?? fn.loc;
    if (span === undefined || !containsLine(span, line)) continue;
    file.f[id] = Math.max(file.f[id] ?? 0, 1);
    hit = true;
  }
  for (const [id, branch] of Object.entries(file.branchMap)) {
    const locations = branch.locations ?? [];
    const counts = file.b[id] ?? [];
    locations.forEach((span, index) => {
      if (!containsLine(span, line)) return;
      counts[index] = Math.max(counts[index] ?? 0, 1);
      hit = true;
    });
    file.b[id] = counts;
  }
  return hit;
}

function containsLine(span: Span, line: number): boolean {
  return line >= span.start.line && line <= span.end.line;
}

function metricsFor(path: string, file: IstanbulFile | undefined): FileMetrics {
  if (file === undefined) {
    return { path, lines: 0, statements: 0, branches: 0, functions: 0 };
  }
  const lineHits = new Map<number, boolean>();
  for (const [id, span] of Object.entries(file.statementMap)) {
    const covered = (file.s[id] ?? 0) > 0;
    for (let line = span.start.line; line <= span.end.line; line += 1) {
      lineHits.set(line, (lineHits.get(line) ?? false) || covered);
    }
  }
  let coveredLines = 0;
  for (const covered of lineHits.values()) {
    if (covered) coveredLines += 1;
  }
  const statements = Object.values(file.s);
  const functions = Object.values(file.f);
  const branches = Object.values(file.b).flat();
  return {
    path,
    lines: percent(coveredLines, lineHits.size),
    statements: percent(statements.filter((count) => count > 0).length, statements.length),
    branches: percent(branches.filter((count) => count > 0).length, branches.length),
    functions: percent(functions.filter((count) => count > 0).length, functions.length),
  };
}

function lcovText(files: Map<string, IstanbulFile>): string {
  const records: string[] = [];
  for (const path of [...files.keys()].sort((left, right) => left.localeCompare(right))) {
    const file = files.get(path);
    if (file === undefined) continue;
    records.push(lcovRecord(path, file));
  }
  return records.length === 0 ? "" : `${records.join("\n")}\n`;
}

function lcovRecord(path: string, file: IstanbulFile): string {
  const lines = ["TN:", `SF:${path}`];
  const functions = Object.entries(file.fnMap);
  let coveredFunctions = 0;
  for (const [id, fn] of functions) {
    const span = fn.decl ?? fn.loc;
    lines.push(`FN:${span?.start.line ?? 0},${lcovName(fn.name, id)}`);
  }
  lines.push(`FNF:${functions.length}`);
  for (const [id, fn] of functions) {
    const hits = file.f[id] ?? 0;
    if (hits > 0) coveredFunctions += 1;
    lines.push(`FNDA:${hits},${lcovName(fn.name, id)}`);
  }
  lines.push(`FNH:${coveredFunctions}`);

  let branches = 0;
  let coveredBranches = 0;
  for (const [id, branch] of Object.entries(file.branchMap)) {
    const locations = branch.locations ?? [];
    const counts = file.b[id] ?? [];
    locations.forEach((span, index) => {
      branches += 1;
      const taken = counts[index] ?? 0;
      if (taken > 0) coveredBranches += 1;
      lines.push(`BRDA:${span.start.line},${id},${index},${taken}`);
    });
  }
  lines.push(`BRF:${branches}`, `BRH:${coveredBranches}`);

  const lineHits = new Map<number, number>();
  for (const [id, span] of Object.entries(file.statementMap)) {
    const count = file.s[id] ?? 0;
    for (let line = span.start.line; line <= span.end.line; line += 1) {
      lineHits.set(line, Math.max(lineHits.get(line) ?? 0, count));
    }
  }
  let coveredLines = 0;
  for (const [line, count] of [...lineHits.entries()].sort((left, right) => left[0] - right[0])) {
    if (count > 0) coveredLines += 1;
    lines.push(`DA:${line},${count}`);
  }
  lines.push(`LF:${lineHits.size}`, `LH:${coveredLines}`, "end_of_record");
  return lines.join("\n");
}

function lcovName(name: string | undefined, id: string): string {
  const label = name === undefined || name.length === 0 ? `anonymous_${id}` : name;
  return label.replaceAll("\n", " ").replaceAll(",", "_");
}

function percent(covered: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((covered / total) * 1000) / 10;
}

function normalizeSource(source: string, root: string): string {
  const cleaned = source.replaceAll("\\", "/");
  const absolute = cleaned.startsWith("/") || /^[A-Za-z]:\//.test(cleaned)
    ? cleaned
    : resolve(root, "dist", cleaned);
  return toRelative(root, absolute);
}

function toRelative(root: string, path: string): string {
  const absolute = path.startsWith("file://") ? new URL(path).pathname : path;
  return relative(root, absolute).split(sep).join("/");
}

async function walk(dir: string, root: string, found: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, root, found);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    found.push(relative(root, path).split(sep).join("/"));
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    await main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "coverage report failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
