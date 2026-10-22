import { type Command } from "commander";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { RelayError } from "../core/error.js";
import { installCommand, versionMeets } from "../core/preflight.js";
import { schemaVersion } from "../core/vocab.js";
import { bundledSkillsRoot, packageVersion } from "../version.js";
import { commandJson } from "./distill.js";
import { writeResult } from "./output.js";

// The install folder for each supported tool. These paths match the ones that
// `npx skills add` uses. `--dir` replaces this path.
export const skillToolDirs = {
  "claude-code": ".claude/skills",
  cursor: ".agents/skills",
  codex: ".agents/skills",
  antigravity: ".agents/skills",
  kiro: ".kiro/skills",
} as const;

export type SkillTool = keyof typeof skillToolDirs;

export type SkillInstallRow = {
  name: string;
  path: string;
  status: "installed" | "present";
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
  status: "ok" | "missing" | "mismatch";
  required?: string;
};

export type SkillsStatusResult = {
  schema: 1;
  installed: string;
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
  const names = readdirSync(root).filter((name) => name.startsWith("atry-")).sort();
  const bundles = names.filter((name) => existsSync(join(root, name, "SKILL.md")));
  if (bundles.length === 0) {
    throw new RelayError("not_found", "bundled skills are missing", "skills");
  }
  return bundles;
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
    const target = join(dir, name);
    if (existsSync(join(target, "SKILL.md"))) {
      return { name, path: target, status: "present" as const };
    }
    cpSync(join(source, name), target, { recursive: true });
    return { name, path: target, status: "installed" as const };
  });
  return { schema: schemaVersion, tool: input.tool, dir, bundles };
}

export function skillsInstallText(result: SkillsInstallResult): string {
  const installed = result.bundles.filter((row) => row.status === "installed").length;
  const present = result.bundles.length - installed;
  return [
    `tool: ${result.tool}`,
    `dir: ${result.dir}`,
    `installed: ${installed}`,
    `present: ${present}`,
  ].join("\n") + "\n";
}

function requiredRange(text: string): string | undefined {
  return requiresPattern.exec(text)?.[1];
}

function releaseVersion(version: string): string {
  const at = version.indexOf("-");
  return at === -1 ? version : version.slice(0, at);
}

function checkBundle(dir: string, name: string, installed: string): SkillStatusRow {
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
  return { name, path, status: fits ? "ok" : "mismatch", required };
}

export function statusSkills(input: {
  tool?: SkillTool;
  dir?: string;
  root?: string;
  installed?: string;
}): SkillsStatusResult {
  const source = input.root ?? bundledSkillsRoot();
  const installed = input.installed ?? packageVersion();
  const names = bundledSkillNames(source);
  const dirs = input.dir !== undefined
    ? [resolve(input.dir)]
    : input.tool !== undefined
    ? [resolve(join(homedir(), skillToolDirs[input.tool]))]
    : [...new Set(Object.values(skillToolDirs))].map((dir) => resolve(join(homedir(), dir)));
  const rows = dirs.map((dir) => ({
    dir,
    bundles: names.map((name) => checkBundle(dir, name, installed)),
  }));
  const ok = rows.every((row) => row.bundles.every((bundle) => bundle.status === "ok"));
  return { schema: schemaVersion, installed, ok, dirs: rows };
}

export function skillsStatusText(result: SkillsStatusResult): string {
  const lines = [`installed: ${result.installed}`];
  for (const dir of result.dirs) {
    lines.push(`dir: ${dir.dir}`);
    for (const bundle of dir.bundles) {
      const required = bundle.required === undefined ? "" : ` (${bundle.required})`;
      lines.push(`- ${bundle.name}: ${bundle.status}${required}`);
    }
  }
  lines.push(`ok: ${result.ok ? "yes" : "no"}`);
  if (!result.ok) lines.push(`install: ${installCommand}`);
  return `${lines.join("\n")}\n`;
}

export function registerSkills(program: Command): void {
  const skills = program.command("skills").description("Install and check the bundled skills");
  skills
    .command("install")
    .description("Copy the bundled skills into a tool directory")
    .requiredOption("--tool <name>", `tool name: ${Object.keys(skillToolDirs).join(", ")}`)
    .option("--dir <path>", "install into this directory")
    .action((opts: { tool: string; dir?: string }, command: Command) => {
      const result = installSkills({
        tool: parseSkillTool(opts.tool),
        ...(opts.dir === undefined ? {} : { dir: opts.dir }),
      });
      writeResult(result, commandJson(command), skillsInstallText);
    });
  skills
    .command("status")
    .description("Compare the installed skills with the running CLI")
    .option("--tool <name>", `tool name: ${Object.keys(skillToolDirs).join(", ")}`)
    .option("--dir <path>", "check this directory")
    .action((opts: { tool?: string; dir?: string }, command: Command) => {
      const tool = opts.tool === undefined ? undefined : parseSkillTool(opts.tool);
      const result = statusSkills({
        ...(tool === undefined ? {} : { tool }),
        ...(opts.dir === undefined ? {} : { dir: opts.dir }),
      });
      writeResult(result, commandJson(command), skillsStatusText);
      if (!result.ok) process.exitCode = 1;
    });
}
