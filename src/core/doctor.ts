import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { bundledSkillsRoot, packageVersion } from "../version.js";
import { RelayError } from "./error.js";
import { gitProgram } from "./git.js";
import { checkPolicy, type PolicyCheckResult } from "./policy.js";
import { schemaVersion } from "./vocab.js";

const execFileAsync = promisify(execFile);
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-dev)?$/;
const windowsSuffixes = [".exe", ".cmd", ".bat", ""];

export type DoctorCheck = {
  name: "node" | "git" | "version" | "skills" | "policy" | "path";
  ok: boolean;
  detail: string;
};

export type DoctorResult = {
  schema: 1;
  ok: boolean;
  checks: DoctorCheck[];
};

export type DoctorInput = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
  cliVersion?: string;
  readVersion?: () => string;
  skillsRoot?: string;
  gitText?: () => Promise<string>;
  loadPolicy?: (cwd: string) => Promise<Pick<PolicyCheckResult, "path">>;
};

export function doctorText(result: DoctorResult): string {
  return `${
    result.checks.map((check) => `${check.name}: ${check.ok ? "ok" : "fail"} ${check.detail}`)
      .join("\n")
  }\n`;
}

export async function doctorReport(input: DoctorInput): Promise<DoctorResult> {
  const checks = [
    nodeCheck(input.nodeVersion ?? process.versions.node),
    await gitCheck(input.gitText ?? defaultGitText(gitProgram)),
    versionFrom(input),
    skillsCheck(input.skillsRoot),
    await policyCheck(input.cwd, input.loadPolicy ?? checkPolicy),
    pathCheck(input.env, input.platform ?? process.platform),
  ];
  return { schema: schemaVersion, ok: checks.every((check) => check.ok), checks };
}

export function nodeCheck(version: string): DoctorCheck {
  const major = Number(version.split(".")[0]);
  const ok = Number.isInteger(major) && major >= 22;
  return {
    name: "node",
    ok,
    detail: ok ? `v${version}` : `need Node 22 or newer, found ${version}`,
  };
}

export function versionCheck(version: string): DoctorCheck {
  const ok = versionPattern.test(version);
  return { name: "version", ok, detail: ok ? version : `bad version ${version}` };
}

export async function gitCheck(read: () => Promise<string>): Promise<DoctorCheck> {
  try {
    const text = (await read()).trim();
    const end = text.indexOf("\n");
    const line = end === -1 ? text : text.slice(0, end);
    return { name: "git", ok: true, detail: line.length > 0 ? line : "git" };
  } catch {
    return { name: "git", ok: false, detail: "git is missing" };
  }
}

export function skillsCheck(root?: string): DoctorCheck {
  try {
    const count = countBundles(root ?? bundledSkillsRoot());
    return { name: "skills", ok: true, detail: String(count) };
  } catch (error) {
    const detail = error instanceof RelayError ? error.message : "bundled skills are missing";
    return { name: "skills", ok: false, detail };
  }
}

export async function policyCheck(
  cwd: string,
  load: (cwd: string) => Promise<Pick<PolicyCheckResult, "path">> = checkPolicy,
): Promise<DoctorCheck> {
  try {
    const result = await load(cwd);
    return { name: "policy", ok: true, detail: result.path };
  } catch (error) {
    if (error instanceof RelayError && error.message === ".agent-relay.json not found") {
      return { name: "policy", ok: true, detail: "default" };
    }
    const detail = error instanceof Error ? error.message : "policy check failed";
    return { name: "policy", ok: false, detail };
  }
}

export function pathCheck(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): DoctorCheck {
  const found = commandOnPath("atry", env, platform);
  return {
    name: "path",
    ok: found,
    detail: found ? "atry" : "atry is missing from PATH",
  };
}

function versionFrom(input: DoctorInput): DoctorCheck {
  try {
    return versionCheck(input.cliVersion ?? (input.readVersion ?? packageVersion)());
  } catch {
    return { name: "version", ok: false, detail: "CLI version is missing" };
  }
}

function defaultGitText(program: string): () => Promise<string> {
  return async () => (await execFileAsync(program, ["--version"])).stdout;
}

function countBundles(root: string): number {
  const names = readdirSync(root);
  const bundles = names.filter((name) =>
    name.startsWith("atry-") && existsSync(join(root, name, "SKILL.md"))
  );
  if (bundles.length === 0) {
    throw new RelayError("not_found", "bundled skills are missing", "skills");
  }
  return bundles.length;
}

function commandOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): boolean {
  const suffixes = platform === "win32" ? windowsSuffixes : [""];
  for (const dir of pathValue(env, platform).split(delimiter)) {
    if (dir.length === 0) continue;
    for (const suffix of suffixes) {
      if (isFile(join(dir, `${name}${suffix}`))) return true;
    }
  }
  return false;
}

function pathValue(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "path") return env[key] ?? "";
    }
    return "";
  }
  return env.PATH ?? "";
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}
