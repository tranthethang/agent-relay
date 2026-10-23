import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { bundledSkillsRoot, packageVersion } from "../version.js";
import { RelayError } from "./error.js";
import { gitProgram } from "./git.js";
import { checkPolicy, type PolicyCheckResult } from "./policy.js";
import { type SkillsStatusResult, statusSkills } from "./skills.js";
import { schemaVersion } from "./vocab.js";

const execFileAsync = promisify(execFile);
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-dev)?$/;
const windowsSuffixes = [".exe", ".cmd", ".bat", ""];

export type DoctorCheck = {
  name:
    | "node"
    | "git"
    | "version"
    | "skills"
    | "installed-skills"
    | "policy"
    | "path"
    | "path-version";
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
  installedSkills?: () => SkillsStatusResult;
  pathVersion?: () => Promise<string>;
};

export function doctorText(result: DoctorResult): string {
  return `${
    result.checks.map((check) => `${check.name}: ${check.ok ? "ok" : "fail"} ${check.detail}`)
      .join("\n")
  }\n`;
}

export async function doctorReport(input: DoctorInput): Promise<DoctorResult> {
  const platform = input.platform ?? process.platform;
  const running = runningVersion(input);
  const file = findOnPath("atry", input.env, platform);
  const checks = [
    nodeCheck(input.nodeVersion ?? process.versions.node),
    await gitCheck(input.gitText ?? defaultGitText(gitProgram)),
    versionFrom(running),
    skillsCheck(input.skillsRoot),
    installedSkillsCheck(input),
    await policyCheck(input.cwd, input.loadPolicy ?? checkPolicy),
    pathCheckFrom(file),
    await pathVersionCheck(input, file, running, platform),
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
    return { name: "skills", ok: true, detail: `bundled: ${count}` };
  } catch (error) {
    const detail = error instanceof RelayError ? error.message : "bundled skills are missing";
    return { name: "skills", ok: false, detail };
  }
}

export function installedSkillsCheck(input: {
  installedSkills?: () => SkillsStatusResult;
}): DoctorCheck {
  let result: SkillsStatusResult;
  try {
    result = (input.installedSkills ?? (() => statusSkills({})))();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "installed skills are missing";
    return { name: "installed-skills", ok: false, detail };
  }
  if (result.dirs.length === 0) {
    return { name: "installed-skills", ok: false, detail: "no tool skill directory" };
  }
  const rows = result.dirs.flatMap((dir) => dir.bundles);
  const failed = rows.filter((row) => row.status !== "ok");
  if (failed.length === 0) {
    return { name: "installed-skills", ok: true, detail: `${rows.length} ok` };
  }
  const names = failed.map((row) => `${row.name} ${row.status}`).join(", ");
  return { name: "installed-skills", ok: false, detail: names };
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
  return pathCheckFrom(findOnPath("atry", env, platform));
}

function pathCheckFrom(file: string | undefined): DoctorCheck {
  return {
    name: "path",
    ok: file !== undefined,
    detail: file === undefined ? "atry is missing from PATH" : "atry",
  };
}

async function pathVersionCheck(
  input: DoctorInput,
  file: string | undefined,
  running: string | undefined,
  platform: NodeJS.Platform,
): Promise<DoctorCheck> {
  if (file === undefined && input.pathVersion === undefined) {
    return { name: "path-version", ok: false, detail: "atry is missing from PATH" };
  }
  let raw: string;
  try {
    if (input.pathVersion !== undefined) raw = await input.pathVersion();
    else if (file !== undefined) raw = await readPathVersion(file, platform);
    else return { name: "path-version", ok: false, detail: "atry is missing from PATH" };
  } catch {
    return { name: "path-version", ok: false, detail: "PATH atry did not report a version" };
  }
  const found = raw.split("\n")[0]?.trim() ?? "";
  if (running === undefined) {
    return {
      name: "path-version",
      ok: false,
      detail: `PATH atry is ${found}, the running CLI has no version`,
    };
  }
  const same = releaseBase(found) === releaseBase(running);
  return {
    name: "path-version",
    ok: same,
    detail: same
      ? `path ${found}, running ${running}`
      : `PATH atry is ${found}, running ${running}`,
  };
}

export async function readPathVersion(
  file: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const shell = platform === "win32" && /\.(cmd|bat)$/i.test(file);
  const { stdout } = await execFileAsync(file, ["version"], { shell });
  return stdout;
}

function runningVersion(input: DoctorInput): string | undefined {
  try {
    return input.cliVersion ?? (input.readVersion ?? packageVersion)();
  } catch {
    return undefined;
  }
}

function releaseBase(version: string): string {
  const at = version.indexOf("-");
  return at === -1 ? version : version.slice(0, at);
}

function versionFrom(version: string | undefined): DoctorCheck {
  if (version === undefined) {
    return { name: "version", ok: false, detail: "CLI version is missing" };
  }
  return versionCheck(version);
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

function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | undefined {
  const suffixes = platform === "win32" ? windowsSuffixes : [""];
  for (const dir of pathValue(env, platform).split(delimiter)) {
    if (dir.length === 0) continue;
    for (const suffix of suffixes) {
      const file = join(dir, `${name}${suffix}`);
      if (isFile(file)) return file;
    }
  }
  return undefined;
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
