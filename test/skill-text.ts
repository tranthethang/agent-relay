import { readFileSync } from "node:fs";

const forbidden = /\b(mktemp|trap|heredoc|grep|sed)\b/;

export function skillText(name: string): string {
  return readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
}

export function assertNoShellSnippet(text: string): string | undefined {
  if (text.includes("```bash") || text.includes("```sh")) return "shell fence";
  const hit = forbidden.exec(text);
  return hit?.[0];
}

export function preflightBody(): string {
  return readFileSync(new URL("../docs/partials/preflight.md", import.meta.url), "utf8").trim();
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

export function compareCalver(left: string, right: string): number {
  const a = calverParts(left);
  const b = calverParts(right);
  for (let index = 0; index < 3; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function requiresFits(required: string, version: string): boolean {
  return compareCalver(required, version) <= 0;
}

export function requiredVersion(): string {
  const required = sharedRequires(skillNames.map((name) => skillText(name)));
  const version = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();
  if (!requiresFits(required, version)) {
    throw new Error("requires-atry is higher than VERSION");
  }
  return required.replace(/^[<>=]+/, "");
}

function calverParts(value: string): number[] {
  const bare = value.replace(/^[<>=]+/, "");
  const parts = bare.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[0-9]+$/.test(part))) {
    throw new Error("bad calver");
  }
  return parts.map((part) => Number(part));
}
