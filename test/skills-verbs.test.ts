import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { versionMeets } from "../src/core/preflight.js";
import { runCli } from "./helper.js";
import { skillMinimumVersion, skillNames, skillText } from "./skill-text.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// A word is part of the command path while it looks like a verb. `<run>` and
// `--flag` end the path, so `atry task done <run>` yields ["task", "done"].
function commandPath(snippet: string): string[] {
  const words: string[] = [];
  for (const token of snippet.trim().split(/\s+/)) {
    if (!/^[a-z][a-z-]*$/.test(token)) break;
    words.push(token);
  }
  return words.slice(0, 2);
}

// Every `atry ...` command that a SKILL.md names, in backticks or in plain text.
export function atryCommands(text: string): string[][] {
  const found = new Map<string, string[]>();
  for (const match of text.matchAll(/`atry ([^`]+)`/g)) {
    const path = commandPath(match[1] ?? "");
    if (path.length > 0) found.set(path.join(" "), path);
  }
  return [...found.values()];
}

export async function unknownCommands(text: string): Promise<string[]> {
  const unknown: string[] = [];
  for (const path of atryCommands(text)) {
    const help = await runCli([...path, "--help"], repoRoot);
    const output = `${help.stdout}${help.stderr}`;
    if (help.code !== 0 || !output.includes(`Usage: atry ${path.join(" ")}`)) {
      unknown.push(path.join(" "));
    }
  }
  return unknown;
}

test("every atry command named by a skill exists", async () => {
  const commands = skillNames.flatMap((name) => atryCommands(skillText(name)));
  expect(commands.length).toBeGreaterThan(20);
  expect(await unknownCommands(skillNames.map((name) => skillText(name)).join("\n"))).toEqual([]);
});

test("every skill names the file conventions and the dev-build rule", async () => {
  for (const name of skillNames) {
    const text = skillText(name);
    expect(text, name).toContain(
      "Read `references/file-conventions.md` before you edit a run file.",
    );
    expect(text, name).toContain("A dev build needs `--allow-dev` or `ATRY_DEV=1`");
  }
  expect(await unknownCommands(skillNames.map((name) => skillText(name)).join("\n"))).toEqual([]);
});

test("the verb check fails on a skill that names atry bogus", async () => {
  expect(atryCommands("Run `atry bogus <run> --json`.")).toEqual([["bogus"]]);
  expect(await unknownCommands("Run `atry bogus <run> --json`.")).toEqual(["bogus"]);
});

test("a skill command with a bad verb under a real group is unknown", async () => {
  expect(await unknownCommands("Run `atry stage bogus <run>`.")).toEqual(["stage bogus"]);
});

test("the skills require a CLI newer than 0.10.6", () => {
  expect(skillMinimumVersion).toBe("0.10.7");
  expect(versionMeets("0.10.6", `>=${skillMinimumVersion}`)).toBe(false);
  expect(versionMeets("0.10.7", `>=${skillMinimumVersion}`)).toBe(true);
});
