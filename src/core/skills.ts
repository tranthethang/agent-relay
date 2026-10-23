import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { bundledSkillsRoot, packageVersion } from "../version.js";
import { RelayError } from "./error.js";
import { installCommandFor, versionMeets } from "./preflight.js";
import { schemaVersion } from "./vocab.js";

// The install folder for each supported tool. These paths match the ones that
// `npx skills add` uses. `--dir` replaces this path.
export const skillToolDirs = {
  "claude-code": ".claude/skills",
  cowork: ".agents/skills",
  cursor: ".agents/skills",
  codex: ".agents/skills",
  antigravity: ".agents/skills",
  kiro: ".kiro/skills",
} as const;

export type SkillTool = keyof typeof skillToolDirs;

export type SkillInstallRow = {
  name: string;
  path: string;
  status: "installed" | "updated" | "unchanged";
};

export type SkillsInstallResult = {
  schema: 1;
  tool: SkillTool;
  dir: string;
  bundles: SkillInstallRow[];
};

export type SkillStatusRow = {
  name: string;
  path: string;
  status: "ok" | "missing" | "stale" | "mismatch";
  required?: string;
};

export type SkillsStatusResult = {
  schema: 1;
  installed: string;
  required: string;
  ok: boolean;
  dirs: { dir: string; bundles: SkillStatusRow[] }[];
};

const requiresPattern = /^requires-atry:\s*"([^"]+)"$/m;

export function parseSkillTool(value: string): SkillTool {
  const tool = value.trim();
  if (Object.hasOwn(skillToolDirs, tool)) return tool as SkillTool;
  throw new RelayError(
    "usage",
    `unknown tool: ${value}. Use ${Object.keys(skillToolDirs).join(", ")}`,
    "tool",
  );
}

export function bundledSkillNames(root: string): string[] {
  const names = readdirSync(root).filter((name) => name.startsWith("atry-"))
    .sort((left, right) => left.localeCompare(right));
  const bundles = names.filter((name) => existsSync(join(root, name, "SKILL.md")));
  if (bundles.length === 0) {
    throw new RelayError("not_found", "bundled skills are missing", "skills");
  }
  return bundles;
}

// Every file under one bundle, as sorted paths relative to the bundle root.
// The separator is normalized so a Windows run hashes the same names.
function bundleFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  const entries = readdirSync(join(dir, prefix), { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...bundleFiles(dir, relative));
    else files.push(relative.split(sep).join("/"));
  }
  return files;
}

function hashFiles(dir: string, files: string[]): string | undefined {
  const hash = createHash("sha256");
  for (const file of files) {
    const path = join(dir, ...file.split("/"));
    if (!existsSync(path)) return undefined;
    hash.update(file).update("\0").update(readFileSync(path)).update("\0");
  }
  return hash.digest("hex");
}

// A content hash for one bundle. A changed `SKILL.md`, reference, or example
// changes the hash. Extra local files outside the bundle do not.
export function bundleHash(dir: string): string {
  const hash = hashFiles(dir, bundleFiles(dir));
  if (hash === undefined) throw new RelayError("not_found", "bundled skills are missing", "skills");
  return hash;
}

// Hash the installed files that the source bundle names. Extra local files do
// not count. A missing canonical file returns undefined.
export function installedBundleHash(sourceDir: string, installedDir: string): string | undefined {
  return hashFiles(installedDir, bundleFiles(sourceDir));
}

export function installSkills(input: {
  tool: SkillTool;
  dir?: string;
  root?: string;
}): SkillsInstallResult {
  const source = input.root ?? bundledSkillsRoot();
  const dir = resolve(input.dir ?? join(homedir(), skillToolDirs[input.tool]));
  mkdirSync(dir, { recursive: true });
  const bundles = bundledSkillNames(source).map((name) => {
    const from = join(source, name);
    const target = join(dir, name);
    if (!existsSync(join(target, "SKILL.md"))) {
      cpSync(from, target, { recursive: true, force: true });
      return { name, path: target, status: "installed" as const };
    }
    if (bundleHash(from) === installedBundleHash(from, target)) {
      return { name, path: target, status: "unchanged" as const };
    }
    cpSync(from, target, { recursive: true, force: true });
    return { name, path: target, status: "updated" as const };
  });
  return { schema: schemaVersion, tool: input.tool, dir, bundles };
}

function countStatus(result: SkillsInstallResult, status: SkillInstallRow["status"]): number {
  return result.bundles.filter((row) => row.status === status).length;
}

export function skillsInstallText(result: SkillsInstallResult): string {
  return [
    `tool: ${result.tool}`,
    `dir: ${result.dir}`,
    `installed: ${countStatus(result, "installed")}`,
    `updated: ${countStatus(result, "updated")}`,
    `unchanged: ${countStatus(result, "unchanged")}`,
  ].join("\n") + "\n";
}

function requiredRange(text: string): string | undefined {
  return requiresPattern.exec(text)?.[1];
}

function releaseVersion(version: string): string {
  const at = version.indexOf("-");
  return at === -1 ? version : version.slice(0, at);
}

function checkBundle(
  dir: string,
  source: string,
  name: string,
  installed: string,
): SkillStatusRow {
  const path = join(dir, name);
  const skill = join(path, "SKILL.md");
  if (!existsSync(skill)) return { name, path, status: "missing" };
  const required = requiredRange(readFileSync(skill, "utf8"));
  if (required === undefined) return { name, path, status: "mismatch" };
  let fits = false;
  try {
    fits = versionMeets(releaseVersion(installed), required);
  } catch {
    fits = false;
  }
  if (!fits) return { name, path, status: "mismatch", required };
  const sourceDir = join(source, name);
  const matches = existsSync(join(sourceDir, "SKILL.md"))
    && installedBundleHash(sourceDir, path) === bundleHash(sourceDir);
  return { name, path, status: matches ? "ok" : "stale", required };
}

// The default check uses only tool directories that exist. `--all` uses every
// known directory. An explicit `--dir` or `--tool` checks exactly one.
function skillStatusDirs(input: { tool?: SkillTool; dir?: string; all?: boolean }): string[] {
  if (input.dir !== undefined) return [resolve(input.dir)];
  if (input.tool !== undefined) return [resolve(join(homedir(), skillToolDirs[input.tool]))];
  const known = [...new Set(Object.values(skillToolDirs))]
    .map((dir) => resolve(join(homedir(), dir)));
  if (input.all === true) return known;
  return known.filter((dir) => existsSync(dir));
}

function higherRange(left: string, right: string): string {
  try {
    return versionMeets(left.replace(/^>=/, ""), right) ? left : right;
  } catch {
    return right;
  }
}

function bundledFloor(source: string, names: readonly string[]): string {
  let best: string | undefined;
  for (const name of names) {
    const floor = requiredRange(readFileSync(join(source, name, "SKILL.md"), "utf8"));
    if (floor === undefined) continue;
    best = best === undefined ? floor : higherRange(best, floor);
  }
  return best ?? ">=0.0.0";
}

export function statusSkills(input: {
  tool?: SkillTool;
  dir?: string;
  root?: string;
  installed?: string;
  all?: boolean;
}): SkillsStatusResult {
  const source = input.root ?? bundledSkillsRoot();
  const installed = input.installed ?? packageVersion();
  const names = bundledSkillNames(source);
  const dirs = skillStatusDirs(input);
  const rows = dirs.map((dir) => ({
    dir,
    bundles: names.map((name) => checkBundle(dir, source, name, installed)),
  }));
  const ok = rows.length > 0
    && rows.every((row) => row.bundles.every((bundle) => bundle.status === "ok"));
  return {
    schema: schemaVersion,
    installed,
    required: bundledFloor(source, names),
    ok,
    dirs: rows,
  };
}

export function skillsStatusText(result: SkillsStatusResult): string {
  const lines = [`installed: ${result.installed}`];
  if (result.dirs.length === 0) lines.push("dirs: none");
  for (const dir of result.dirs) {
    lines.push(`dir: ${dir.dir}`);
    for (const bundle of dir.bundles) {
      const required = bundle.required === undefined ? "" : ` (${bundle.required})`;
      lines.push(`- ${bundle.name}: ${bundle.status}${required}`);
    }
  }
  lines.push(`ok: ${result.ok ? "yes" : "no"}`);
  if (!result.ok) lines.push(`install: ${installCommandFor(result.required)}`);
  return `${lines.join("\n")}\n`;
}
