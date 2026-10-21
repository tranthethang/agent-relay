// Per-file coverage report for handwritten TypeScript.
// Usage:
//   node --experimental-strip-types scripts/maint/coverage-report.ts

import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
const sonarProjectKey = "agent-relay";
const overallMinimum = 95;
const fileMinimum = 90;
const fileBranchMinimum = 90;
const analysisAttempts = 300;
const analysisPauseMs = 1000;

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

export function assertCoverageBars(
  root: string,
  coverage: Record<string, IstanbulFile>,
): void {
  const files = indexByRelative(coverage, root);
  let covered = 0;
  let total = 0;
  const low: string[] = [];
  const lowBranches: string[] = [];
  for (const path of [...files.keys()].sort((left, right) => left.localeCompare(right))) {
    if (!isGatedPath(path)) continue;
    const file = files.get(path);
    if (file === undefined) continue;
    const totals = lineBranchTotals(file);
    if (totals.totalLines === 0) continue;
    const fileCovered = totals.coveredLines + totals.coveredBranches;
    const fileTotal = totals.totalLines + totals.totalBranches;
    covered += fileCovered;
    total += fileTotal;
    const metric = percent(fileCovered, fileTotal);
    if (metric <= fileMinimum) low.push(`${path} ${metric}`);
    const branchMetric = percent(totals.coveredBranches, totals.totalBranches);
    if (branchMetric < fileBranchMinimum) lowBranches.push(`${path} ${branchMetric}`);
  }
  const overall = percent(covered, total);
  if (overall < overallMinimum) {
    throw new Error(`overall coverage below ${overallMinimum}%: ${overall}`);
  }
  if (low.length > 0) {
    throw new Error(`per-file coverage at or below ${fileMinimum}%: ${low.join(", ")}`);
  }
  if (lowBranches.length > 0) {
    throw new Error(
      `per-file branch coverage below ${fileBranchMinimum}%: ${lowBranches.join(", ")}`,
    );
  }
}

export async function assertDuplication(input: {
  root: string;
  env: NodeJS.ProcessEnv;
  runScanner?: (root: string, env: NodeJS.ProcessEnv) => Promise<void>;
  readTaskFile?: (root: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
}): Promise<void> {
  const host = sonarHost(input.env);
  const token = sonarToken(input.env);
  const fetchImpl = input.fetchImpl ?? fetch;
  await (input.runScanner ?? runScannerCommand)(input.root, input.env);
  const taskId = parseCeTaskId(await (input.readTaskFile ?? readScannerTask)(input.root));
  await waitForAnalysis({
    host,
    token,
    taskId,
    fetchImpl,
    sleep: input.sleep ?? delay,
    attempts: input.attempts ?? analysisAttempts,
  });
  const body = await readJson(measuresUrl(host), token, fetchImpl);
  assertDensity(readDensity(body));
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
  assertCoverageBars(root, coverage);
  await assertDuplication({ root, env: process.env });
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
  const totals = lineBranchTotals(file);
  const statements = Object.values(file.s);
  const functions = Object.values(file.f);
  return {
    path,
    lines: percent(totals.coveredLines, totals.totalLines),
    statements: percent(statements.filter((count) => count > 0).length, statements.length),
    branches: percent(totals.coveredBranches, totals.totalBranches),
    functions: percent(functions.filter((count) => count > 0).length, functions.length),
  };
}

type LineBranchTotals = {
  coveredLines: number;
  totalLines: number;
  coveredBranches: number;
  totalBranches: number;
};

function lineBranchTotals(file: IstanbulFile): LineBranchTotals {
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
  const branches = Object.values(file.b).flat();
  return {
    coveredLines,
    totalLines: lineHits.size,
    coveredBranches: branches.filter((count) => count > 0).length,
    totalBranches: branches.length,
  };
}

function isGatedPath(path: string): boolean {
  return path.startsWith("src/") || path.startsWith("scripts/maint/");
}

function sonarHost(env: NodeJS.ProcessEnv): string {
  const host = trimTrailingSlashes(env.SONAR_HOST_URL?.trim() ?? "");
  if (host.length === 0) throw new Error("SONAR_HOST_URL missing");
  return host;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

function sonarToken(env: NodeJS.ProcessEnv): string {
  const token = env.SONAR_TOKEN?.trim() ?? "";
  if (token.length === 0) throw new Error("SONAR_TOKEN missing");
  return token;
}

export function scannerName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "sonar-scanner.cmd" : "sonar-scanner";
}

async function runScannerCommand(root: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await execFileAsync(scannerName(), [], {
      cwd: root,
      env,
      windowsHide: true,
      shell: process.platform === "win32",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error: unknown) {
    throw scannerFailure(error);
  }
}

function scannerFailure(error: unknown): Error {
  if (isMissingScanner(error)) return new Error("sonar-scanner missing");
  return new Error("sonar-scanner failed");
}

export function isMissingScanner(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "ENOENT") return true;
  const stderr = "stderr" in error ? outputText(error.stderr) : "";
  return /not recognized as an internal or external command|command not found/i.test(stderr);
}

async function readScannerTask(root: string): Promise<string> {
  try {
    return await readFile(join(root, ".scannerwork", "report-task.txt"), "utf8");
  } catch {
    throw new Error("analysis task id missing");
  }
}

function parseCeTaskId(text: string): string {
  const found = /^ceTaskId=(.*)$/m.exec(text);
  const id = found?.[1]?.trim() ?? "";
  if (id.length === 0) throw new Error("analysis task id missing");
  return id;
}

function measuresUrl(host: string): string {
  const query = new URLSearchParams({
    component: sonarProjectKey,
    metricKeys: "duplicated_lines_density",
  });
  return `${host}/api/measures/component?${query.toString()}`;
}

async function waitForAnalysis(input: {
  host: string;
  token: string;
  taskId: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  attempts: number;
}): Promise<void> {
  const url = `${input.host}/api/ce/task?id=${encodeURIComponent(input.taskId)}`;
  for (let attempt = 1; attempt <= input.attempts; attempt += 1) {
    const status = readTaskStatus(await readJson(url, input.token, input.fetchImpl));
    if (status === "SUCCESS") return;
    if (status === "FAILED" || status === "CANCELED") {
      throw new Error(`analysis task ${status}`);
    }
    await input.sleep(analysisPauseMs);
  }
  throw new Error("analysis task timed out");
}

function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

async function readJson(url: string, token: string, fetchImpl: typeof fetch): Promise<unknown> {
  const credentials = Buffer.from(`${token}:`).toString("base64");
  const response = await fetchImpl(url, { headers: { Authorization: `Basic ${credentials}` } });
  if (!response.ok) throw new Error(`sonar request failed: ${response.status}`);
  return response.json() as Promise<unknown>;
}

function readTaskStatus(body: unknown): string {
  if (!isRecord(body) || !isRecord(body.task)) throw new Error("analysis task status missing");
  const status = body.task.status;
  if (typeof status !== "string" || status.length === 0) {
    throw new Error("analysis task status missing");
  }
  return status;
}

function readDensity(body: unknown): number {
  if (!isRecord(body) || !isRecord(body.component) || !Array.isArray(body.component.measures)) {
    throw new Error("duplicated lines density missing");
  }
  for (const measure of body.component.measures) {
    if (!isRecord(measure) || measure.metric !== "duplicated_lines_density") continue;
    if (typeof measure.value !== "string") throw new Error("duplicated lines density missing");
    const value = Number(measure.value);
    if (!Number.isFinite(value)) throw new Error("duplicated lines density missing");
    return value;
  }
  throw new Error("duplicated lines density missing");
}

function assertDensity(value: number): void {
  if (value > 1) throw new Error(`duplicated lines density above 1%: ${value}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
