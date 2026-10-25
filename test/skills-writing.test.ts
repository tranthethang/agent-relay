import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const partial = readFileSync(
  new URL(
    "../specs/80-skills-integration/00-skill-bridge/writing.md",
    import.meta.url,
  ),
  "utf8",
);

test("glossary uses v2 terms and drops decide and stamp", () => {
  const glossary = partial.slice(
    partial.indexOf("## Glossary"),
    partial.indexOf("## Question card"),
  );
  expect(glossary).toContain("`brainstorm notes`");
  expect(glossary).toContain("`stage folder`");
  expect(glossary).toContain("`events`");
  expect(glossary).toContain("`10-plan/`");
  expect(glossary).not.toMatch(/`decide`/);
  expect(glossary).not.toMatch(/`stamp`/);
});

test("question cards map onto the scaffold open array", () => {
  const cards = partial.slice(partial.indexOf("## Question card"));
  expect(cards).toContain("`open` array");
  expect(cards).toContain("`q`, `a`, and `b`");
  expect(cards).toContain("`q` and `need`");
  expect(cards).toContain("Keep `schema` as `1`");
});

test("writing rules define the Why line", () => {
  expect(partial).toContain("one line that starts with `Why:`");
  expect(partial).toContain("It has 25 words or fewer.");
  expect(partial).toContain(
    "Do not add a `Why:` line to a plain procedure step.",
  );
});

test("each Why line in a SKILL.md has 25 words or fewer", () => {
  const skillsDir = new URL("../skills/", import.meta.url);
  const names = readdirSync(skillsDir).filter((name) => name.startsWith("atry-"));
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const text = readFileSync(new URL(`${name}/SKILL.md`, skillsDir), "utf8");
    for (const line of text.split("\n")) {
      const match = /^\s*(?:- )?Why: (.*)$/.exec(line);
      if (match === null) continue;
      expect(
        match[1].split(/\s+/).filter(Boolean).length,
        `${name}: ${line}`,
      ).toBeLessThanOrEqual(25);
    }
  }
});
