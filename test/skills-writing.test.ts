import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const partial = readFileSync(new URL("../docs/partials/writing.md", import.meta.url), "utf8");

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
