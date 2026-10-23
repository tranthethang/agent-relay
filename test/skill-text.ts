import { readFileSync } from "node:fs";
import {
  requiresFits as schemeFits,
  skillMinimumRange,
  skillMinimumVersion,
} from "../scripts/maint/next-version.ts";

const forbidden = /\b(mktemp|trap|heredoc|grep|sed)\b/;
const scheme = /^>=(0|[1-9][0-9]*)\.([1-9]|1[0-2])\.([0-9]|[1-9][0-9])$/;

export function skillText(name: string): string {
  return readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
}

export function assertNoShellSnippet(text: string): string | undefined {
  if (text.includes("```bash") || text.includes("```sh")) return "shell fence";
  const hit = forbidden.exec(text);
  return hit?.[0];
}

export function preflightBody(): string {
  return readFileSync(
    new URL("../specs/80-skills-integration/00-skill-bridge/preflight.md", import.meta.url),
    "utf8",
  ).trim();
}

const skillNames = [
  "atry-brainstorm",
  "atry-cross-review",
  "atry-distill",
  "atry-implement",
  "atry-plan",
  "atry-self-review",
] as const;

export function requiresAtryValue(text: string): string {
  const match = /^requires-atry:\s*"([^"]+)"$/m.exec(text);
  if (match?.[1] === undefined) throw new Error("requires-atry missing");
  return match[1];
}

export function sharedRequires(texts: readonly string[]): string {
  const values = texts.map((text) => requiresAtryValue(text));
  const first = values[0];
  if (first === undefined || values.some((value) => value !== first)) {
    throw new Error("requires-atry values differ");
  }
  return first;
}

export function requiresFits(required: string, version: string): boolean {
  return schemeFits(required, version);
}

export function requiredVersion(): string {
  const required = sharedRequires(skillNames.map((name) => skillText(name)));
  if (!scheme.test(required)) throw new Error("requires-atry is not >=X.M.Z");
  if (required !== skillMinimumRange) {
    throw new Error(`requires-atry must be ${skillMinimumRange}`);
  }
  return skillMinimumVersion;
}

export { skillMinimumRange, skillMinimumVersion, skillNames };
