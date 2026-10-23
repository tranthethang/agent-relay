// Keep shared files inside skills/*/ bundles identical to their sources.
// Usage:
//   node --experimental-strip-types scripts/maint/sync-references.ts
//   node --experimental-strip-types scripts/maint/sync-references.ts --check
//   node --experimental-strip-types scripts/maint/sync-references.ts --root DIR
// Env: AGENT_RELAY_SYNC_ROOT — default root when --root is not passed.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALL_PARTS = ["core", "review-headings", "parallel", "manifest", "notes"];
const REVIEW_TEMPLATES = ["reviewer-conduct.md"];
const WRITING_SKILLS = [
  "atry-brainstorm",
  "atry-plan",
  "atry-implement",
  "atry-self-review",
  "atry-cross-review",
];

const SKILL_PARTS: Record<string, string[]> = {
  "atry-brainstorm": ["core", "notes"],
  "atry-plan": ["core", "notes"],
  "atry-implement": ["core", "parallel", "notes"],
  "atry-self-review": ["core", "review-headings", "parallel", "notes"],
  "atry-cross-review": ["core", "review-headings", "parallel", "notes"],
  "atry-distill": ["core", "manifest", "notes"],
};

const scriptDir = dirname(fileURLToPath(import.meta.url));

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { checkOnly: boolean; root: string } {
  let root = process.env.AGENT_RELAY_SYNC_ROOT
    ? resolve(process.env.AGENT_RELAY_SYNC_ROOT)
    : resolve(scriptDir, "../..");
  let checkOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") {
      checkOnly = true;
      continue;
    }
    if (arg === "--root") {
      const dir = argv[i + 1];
      if (dir === undefined || dir === "" || dir.startsWith("--")) {
        fail("Error: --root requires a directory argument");
      }
      root = resolve(dir);
      i++;
      continue;
    }
    process.stderr.write(`Error: unknown argument: ${arg}\n`);
    process.stderr.write(
      "Usage: node --experimental-strip-types scripts/maint/sync-references.ts [--check] [--root DIR]\n",
    );
    process.exit(1);
  }
  return { checkOnly, root };
}

function trimBlankLines(text: string): string {
  let raw = text;
  if (raw.endsWith("\n")) raw = raw.slice(0, -1);
  const lines = raw.split("\n");
  let start = 0;
  while (start < lines.length && lines[start] === "") start++;
  let end = lines.length;
  while (end > start && lines[end - 1] === "") end--;
  if (end <= start) return "";
  return `${lines.slice(start, end).join("\n")}\n`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function concatParts(convDir: string, parts: string[]): string {
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const file = join(convDir, `${parts[i]}.md`);
    if (!existsSync(file)) fail(`Error: missing convention part ${file}`);
    if (i > 0) out += "\n";
    out += readFileSync(file, "utf8");
  }
  return out;
}

function writeOrCheck(checkOnly: boolean, dest: string, body: string): boolean {
  if (checkOnly) {
    if (!existsSync(dest)) {
      process.stderr.write(`Missing: ${dest}\n`);
      return false;
    }
    if (readFileSync(dest, "utf8") !== body) {
      process.stderr.write(`Drift: ${dest} differs from generated conventions\n`);
      return false;
    }
    return true;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body);
  process.stdout.write(`synced ${dest}\n`);
  return true;
}

function skillDirs(root: string): string[] {
  const skills = join(root, "skills");
  if (!existsSync(skills)) return [];
  return readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(skills, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function replacePreflight(source: string, body: string): string {
  const ended = source.endsWith("\n");
  const lines = (ended ? source.slice(0, -1) : source).split("\n");
  const bodyLines = body.endsWith("\n") ? body.slice(0, -1).split("\n") : body.split("\n");
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.includes("<!-- BEGIN PREFLIGHT -->")) {
      out.push(line, "", ...bodyLines, "");
      inBlock = true;
    } else if (line.includes("<!-- END PREFLIGHT -->")) {
      inBlock = false;
      out.push(line);
    } else if (!inBlock) {
      out.push(line);
    }
  }
  return ended ? `${out.join("\n")}\n` : out.join("\n");
}

function requireConventionParts(convDir: string): void {
  if (!existsSync(convDir)) fail(`Error: ${convDir} not found`);
  for (const part of ALL_PARTS) {
    const file = join(convDir, `${part}.md`);
    if (!existsSync(file)) fail(`Error: missing convention part ${file}`);
  }
}

function syncSkillBundles(
  convDir: string,
  dirs: readonly string[],
  checkOnly: boolean,
): boolean {
  let drift = false;
  for (const dir of dirs) {
    const name = basename(dir);
    const parts = SKILL_PARTS[name];
    if (parts === undefined) {
      process.stderr.write(`Error: no conventions manifest entry for skill '${name}'\n`);
      drift = true;
      continue;
    }
    const body = concatParts(convDir, parts);
    if (!writeOrCheck(checkOnly, join(dir, "references/file-conventions.md"), body)) drift = true;
    if (removeSkillScripts(join(dir, "scripts"), checkOnly)) drift = true;
  }
  return drift;
}

function removeSkillScripts(scriptsDir: string, checkOnly: boolean): boolean {
  if (!existsSync(scriptsDir)) return false;
  if (checkOnly) {
    process.stderr.write(`Orphan: ${scriptsDir}/ must not exist (use atry CLI)\n`);
    return true;
  }
  rmSync(scriptsDir, { recursive: true, force: true });
  process.stdout.write(`removed ${scriptsDir}/\n`);
  return false;
}

function syncWriting(root: string, checkOnly: boolean): boolean {
  const writing = join(root, "specs/80-skills-integration/00-skill-bridge/writing.md");
  if (!existsSync(writing)) fail(`Error: ${writing} not found`);
  const writingBody = readFileSync(writing, "utf8");
  let drift = false;
  for (const skill of WRITING_SKILLS) {
    const dest = join(root, "skills", skill, "references/writing.md");
    if (!syncOneFile(dest, writingBody, writing, checkOnly)) drift = true;
  }
  return drift;
}

function syncOneFile(dest: string, body: string, source: string, checkOnly: boolean): boolean {
  if (checkOnly) {
    if (!existsSync(dest)) {
      process.stderr.write(`Missing: ${dest}\n`);
      return false;
    }
    if (readFileSync(dest, "utf8") !== body) {
      process.stderr.write(`Drift: ${dest} differs from ${source}\n`);
      return false;
    }
    return true;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body);
  process.stdout.write(`synced ${dest}\n`);
  return true;
}

function syncReviewTemplates(root: string, checkOnly: boolean): boolean {
  const selfReview = join(root, "skills/atry-self-review/references");
  const crossReview = join(root, "skills/atry-cross-review/references");
  let drift = false;
  for (const name of REVIEW_TEMPLATES) {
    if (!syncReviewTemplate(join(selfReview, name), join(crossReview, name), checkOnly)) {
      drift = true;
    }
  }
  return drift;
}

function syncReviewTemplate(src: string, dest: string, checkOnly: boolean): boolean {
  if (checkOnly) return reviewTemplateMatches(src, dest);
  if (!existsSync(src)) fail(`Error: canonical review template missing: ${src}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src));
  process.stdout.write(`synced ${dest}\n`);
  return true;
}

function reviewTemplateMatches(src: string, dest: string): boolean {
  if (!existsSync(src)) {
    process.stderr.write(`Missing: ${src}\n`);
    return false;
  }
  if (!existsSync(dest)) {
    process.stderr.write(`Missing: ${dest}\n`);
    return false;
  }
  if (!readFileSync(src).equals(readFileSync(dest))) {
    process.stderr.write(`Drift: ${dest} differs from ${src}\n`);
    return false;
  }
  return true;
}

function syncPreflight(root: string, dirs: readonly string[], checkOnly: boolean): boolean {
  const preflight = join(root, "specs/80-skills-integration/00-skill-bridge/preflight.md");
  if (!existsSync(preflight)) fail(`Error: ${preflight} not found`);
  const preflightBody = trimBlankLines(readFileSync(preflight, "utf8"));
  const preflightHash = sha256(preflightBody);
  let drift = false;
  for (const dir of dirs) {
    if (!syncSkillPreflight(join(dir, "SKILL.md"), preflightBody, preflightHash, checkOnly)) {
      drift = true;
    }
  }
  return drift;
}

function syncSkillPreflight(
  skillMd: string,
  preflightBody: string,
  preflightHash: string,
  checkOnly: boolean,
): boolean {
  if (!existsSync(skillMd)) {
    process.stderr.write(`Missing: ${skillMd}\n`);
    return false;
  }
  const source = readFileSync(skillMd, "utf8");
  if (!source.includes("<!-- BEGIN PREFLIGHT -->") || !source.includes("<!-- END PREFLIGHT -->")) {
    process.stderr.write(
      `Error: Missing <!-- BEGIN PREFLIGHT --> / <!-- END PREFLIGHT --> markers in ${skillMd}\n`,
    );
    return false;
  }
  const existing = source.split("<!-- BEGIN PREFLIGHT -->")[1]?.split("<!-- END PREFLIGHT -->")[0]
    ?? "";
  if (sha256(trimBlankLines(existing)) === preflightHash) return true;
  if (checkOnly) {
    process.stderr.write(
      `Out of sync: ${skillMd} preflight block differs from sync source\n`,
    );
    return false;
  }
  writeFileSync(skillMd, replacePreflight(source, preflightBody));
  process.stdout.write(`synced preflight into ${skillMd}\n`);
  return true;
}

function main(): void {
  const { checkOnly, root } = parseArgs(process.argv.slice(2));
  const convDir = join(root, "specs/70-storage-and-git/00-directory-conventions");
  requireConventionParts(convDir);

  let drift = false;
  const dirs = skillDirs(root);
  if (dirs.length === 0) fail("Error: no skills/*/ directories");
  if (syncSkillBundles(convDir, dirs, checkOnly)) drift = true;
  if (syncWriting(root, checkOnly)) drift = true;
  if (syncReviewTemplates(root, checkOnly)) drift = true;
  if (syncPreflight(root, dirs, checkOnly)) drift = true;

  if (!checkOnly) return;
  if (drift) {
    process.stderr.write("sync-references --check failed\n");
    process.exit(1);
  }
  process.stdout.write(
    "sync-references: all bundle references match their sources (no skill scripts/)\n",
  );
}

main();
