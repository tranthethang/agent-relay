// Next X.M.Z version from git tags and the month in Asia/Ho_Chi_Minh.
// Usage:
//   node --experimental-strip-types scripts/maint/next-version.ts [--major] [--now <ISO date>]
//   node --experimental-strip-types scripts/maint/next-version.ts --check-requires <version>

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RelayError } from "../../src/core/error.ts";

const tagPattern = /^v(0|[1-9]\d*)\.([1-9]|1[0-2])\.(\d|[1-9]\d)$/;
const schemePattern = /^(0|[1-9]\d*)\.([1-9]|1[0-2])\.(\d|[1-9]\d)$/;
const timeZone = "Asia/Ho_Chi_Minh";
const gitProgram = process.platform === "win32"
  ? String.raw`C:\Program Files\Git\cmd\git.exe`
  : "/usr/bin/git";

export type VersionParts = {
  x: number;
  m: number;
  z: number;
};

// The lowest CLI the six skills may require. Bump it with a skill change that
// needs a newer CLI; the release check refuses a value the release cannot meet.
export const skillMinimumVersion = "0.10.7";
export const skillMinimumRange = `>=${skillMinimumVersion}`;

export function parseTag(tag: string): VersionParts {
  const match = tagPattern.exec(tag);
  if (match === null) {
    throw new RelayError("validation", `tag ${tag} does not match vX.M.Z`, tag);
  }
  return { x: Number(match[1]), m: Number(match[2]), z: Number(match[3]) };
}

export function parseScheme(value: string): VersionParts {
  const match = schemePattern.exec(value);
  if (match === null) {
    throw new RelayError("validation", `version ${value} does not match X.M.Z`, value);
  }
  return { x: Number(match[1]), m: Number(match[2]), z: Number(match[3]) };
}

export function formatVersion(parts: VersionParts): string {
  return `${parts.x}.${parts.m}.${parts.z}`;
}

function cmpPart(left: number, right: number): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareVersion(left: VersionParts, right: VersionParts): number {
  let order = cmpPart(left.x, right.x);
  if (order !== 0) return order;
  order = cmpPart(left.m, right.m);
  if (order !== 0) return order;
  return cmpPart(left.z, right.z);
}

export function monthInHoChiMinh(now: Date): number {
  if (Number.isNaN(now.getTime())) {
    throw new RelayError("validation", "now is not a date", "now");
  }
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
  }).formatToParts(now).find((item) => item.type === "month");
  const month = Number(part?.value);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RelayError("validation", "month is outside 1 to 12", "now");
  }
  return month;
}

export function requiresFits(required: string, version: string): boolean {
  const bare = required.replace(/^>=/, "");
  return compareVersion(parseScheme(bare), parseScheme(version)) <= 0;
}

export function nextVersion(input: {
  tags: readonly string[];
  now: Date;
  major: boolean;
}): { version: string; tag: string } {
  const parsed = input.tags.map((tag) => parseTag(tag));
  const month = monthInHoChiMinh(input.now);
  const next = candidate(parsed, month, input.major);
  if (next.z > 99) throw new RelayError("validation", "Z would pass 99", "z");
  if (parsed.length > 0 && compareVersion(next, highestVersion(parsed)) <= 0) {
    throw new RelayError(
      "validation",
      "version is not higher than the highest tag; set major: true",
      "version",
    );
  }
  const version = formatVersion(next);
  return { version, tag: `v${version}` };
}

export function assertRequires(root: string, version: string): void {
  const skills = join(root, "skills");
  for (const entry of readdirSync(skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const text = readFileSync(join(skills, name, "SKILL.md"), "utf8");
    const match = /^requires-atry:\s*"([^"]+)"$/m.exec(text);
    if (match?.[1] === undefined) {
      throw new RelayError("validation", "requires-atry missing", name);
    }
    if (!requiresFits(match[1], version)) {
      throw new RelayError(
        "validation",
        `requires-atry is higher than ${version}; the shared minimum is ${skillMinimumRange}`,
        name,
      );
    }
  }
}

function highestVersion(parsed: readonly VersionParts[]): VersionParts {
  const first = parsed[0];
  if (first === undefined) {
    throw new RelayError("validation", "tag list is empty", "version");
  }
  let best = first;
  for (const item of parsed.slice(1)) {
    if (compareVersion(item, best) > 0) {
      best = item;
    }
  }
  return best;
}

function candidate(parsed: VersionParts[], month: number, major: boolean): VersionParts {
  if (parsed.length === 0) return { x: 0, m: month, z: 0 };
  const highest = highestVersion(parsed);
  if (major) return { x: highest.x + 1, m: month, z: 0 };
  if (highest.m === month) return { x: highest.x, m: month, z: highest.z + 1 };
  return { x: highest.x, m: month, z: 0 };
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : "next version failed";
  process.stderr.write(`${message}\n`);
  process.exit(error instanceof RelayError ? error.exitCode : 1);
}

function gitTags(): string[] {
  const output = execFileSync(gitProgram, ["tag", "-l", "v*"], { encoding: "utf8" });
  return output.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

function takeArg(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (value === undefined) throw new RelayError("validation", `${name} is missing`, name);
  return value;
}

function parseArgs(
  argv: string[],
): { major: boolean; now: Date; checkRequires: string | undefined } {
  let major = false;
  let now = new Date();
  let checkRequires: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--major") {
      major = true;
      continue;
    }
    if (arg === "--now") {
      now = new Date(takeArg(argv, index, "now"));
      if (Number.isNaN(now.getTime())) {
        throw new RelayError("validation", "now is not a date", "now");
      }
      index += 1;
      continue;
    }
    if (arg === "--check-requires") {
      checkRequires = takeArg(argv, index, "version");
      index += 1;
      continue;
    }
    throw new RelayError("validation", `unknown argument ${arg}`, arg ?? "");
  }
  return { major, now, checkRequires };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.checkRequires !== undefined) {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    assertRequires(root, args.checkRequires);
    return;
  }
  const result = nextVersion({ tags: gitTags(), now: args.now, major: args.major });
  process.stdout.write(`${result.version}\n`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    main();
  } catch (error) {
    fail(error);
  }
}
