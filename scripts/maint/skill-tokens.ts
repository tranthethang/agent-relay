// Estimate skill tokens per stage.
// Count SKILL.md plus each references/*.md path that SKILL.md names.
// Divide the character count by 4 and round to the nearest integer.
// Usage:
//   node --experimental-strip-types scripts/maint/skill-tokens.ts
//   node --experimental-strip-types scripts/maint/skill-tokens.ts --root DIR

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const stageOrder = [
  "brainstorm",
  "plan",
  "implement",
  "self-review",
  "cross-review",
  "distill",
];

const referencePattern = /references\/[A-Za-z0-9._/-]+\.md/g;
const scriptDir = dirname(fileURLToPath(import.meta.url));

type StageCount = {
  stage: string;
  references: string[];
  chars: number;
  tokens: number;
};

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { root: string } {
  let root = resolve(scriptDir, "../..");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const dir = argv[index + 1];
      if (dir === undefined || dir === "" || dir.startsWith("--")) {
        fail("Error: --root requires a directory argument");
      }
      root = resolve(dir);
      index += 1;
      continue;
    }
    fail(`Error: unknown argument: ${arg}`);
  }
  return { root };
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function referencePaths(skillText: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const match of skillText.matchAll(referencePattern)) {
    const relative = match[0];
    if (relative.split("/").includes("..")) {
      fail(`Error: reference path escapes the skill directory: ${relative}`);
    }
    if (seen.has(relative)) continue;
    seen.add(relative);
    paths.push(relative);
  }
  return paths;
}

function stageRank(stage: string): number {
  const index = stageOrder.indexOf(stage);
  return index === -1 ? stageOrder.length : index;
}

function countSkill(skillDir: string, stage: string): StageCount {
  const skillPath = join(skillDir, "SKILL.md");
  const skillText = readText(skillPath);
  const references = referencePaths(skillText);
  let chars = skillText.length;
  for (const relative of references) {
    const path = join(skillDir, relative);
    let text: string;
    try {
      text = readText(path);
    } catch {
      fail(`Error: ${stage} names missing file ${relative}`);
    }
    chars += text.length;
  }
  return {
    stage,
    references,
    chars,
    tokens: Math.round(chars / 4),
  };
}

function listStages(root: string): StageCount[] {
  const skillsDir = join(root, "skills");
  let names: string[];
  try {
    names = readdirSync(skillsDir);
  } catch {
    fail(`Error: skills directory is missing: ${skillsDir}`);
  }
  const counts: StageCount[] = [];
  for (const name of names) {
    if (!name.startsWith("atry-")) continue;
    const stage = name.slice("atry-".length);
    counts.push(countSkill(join(skillsDir, name), stage));
  }
  counts.sort((left, right) => {
    const rank = stageRank(left.stage) - stageRank(right.stage);
    if (rank !== 0) return rank;
    return left.stage.localeCompare(right.stage);
  });
  return counts;
}

function table(counts: StageCount[]): string {
  const totalChars = counts.reduce((sum, row) => sum + row.chars, 0);
  const totalTokens = counts.reduce((sum, row) => sum + row.tokens, 0);
  const lines = [
    "| stage | references | chars | tokens |",
    "| --- | --- | ---: | ---: |",
  ];
  for (const row of counts) {
    const references = row.references.length === 0 ? "(none)" : row.references.join(", ");
    lines.push(`| ${row.stage} | ${references} | ${row.chars} | ${row.tokens} |`);
  }
  lines.push(`| total |  | ${totalChars} | ${totalTokens} |`);
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(table(listStages(args.root)));
}

main();
