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

export function requiredVersion(): string {
  return readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();
}
