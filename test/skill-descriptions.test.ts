import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../skills", import.meta.url));
const names = [
  "atry-brainstorm",
  "atry-plan",
  "atry-implement",
  "atry-self-review",
  "atry-cross-review",
  "atry-distill",
];

function description(name: string): string {
  const text = readFileSync(join(root, name, "SKILL.md"), "utf8");
  const line = text.split("\n").find((row) => row.startsWith("description:"));
  if (line === undefined) throw new Error(`${name} has no description`);
  const value = line.slice("description:".length).trim();
  if (value.startsWith("\"") && value.endsWith("\"")) return value.slice(1, -1);
  return value;
}

for (const name of names) {
  test(`${name} description names the product and a limit`, () => {
    const text = description(name);
    expect(text.length).toBeGreaterThanOrEqual(200);
    expect(text.length).toBeLessThanOrEqual(400);
    expect(text.includes("atry") || text.includes("agent-relay")).toBe(true);
    expect(text).toContain("Do not use");
    expect(text).not.toContain(name);
  });
}
