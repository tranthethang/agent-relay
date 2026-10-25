import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseReviewJson } from "../src/core/review.js";
import { skillText } from "./skill-text.js";

type Example = {
  skill: string;
  file: string;
  headings: string[];
};

const examples: Example[] = [
  {
    skill: "atry-plan",
    file: "references/example-overview.md",
    headings: ["## Goal", "## Non-goals", "## Decisions", "## Constraints"],
  },
  {
    skill: "atry-implement",
    file: "references/example-implement.md",
    headings: ["## Files", "## Changes", "## Assumptions", "## Risks"],
  },
  {
    skill: "atry-self-review",
    file: "references/example-review.md",
    headings: ["## Findings", "## Acceptance"],
  },
  {
    skill: "atry-cross-review",
    file: "references/example-cross-review.md",
    headings: ["## Findings", "## Acceptance"],
  },
];

function exampleText(skill: string, file: string): string {
  return readFileSync(new URL(`../skills/${skill}/${file}`, import.meta.url), "utf8");
}

test("each stage skill names its example and the file exists", () => {
  for (const example of examples) {
    expect(skillText(example.skill)).toContain(example.file);
    expect(existsSync(new URL(`../skills/${example.skill}/${example.file}`, import.meta.url))).toBe(
      true,
    );
  }
});

test("each example shows the headings that its skill asks for", () => {
  for (const example of examples) {
    const text = exampleText(example.skill, example.file);
    for (const heading of example.headings) expect(text).toContain(heading);
    expect(text.length).toBeLessThan(1500);
  }
});

test("each review example has one card and one open item", () => {
  for (const skill of ["atry-self-review", "atry-cross-review"]) {
    const file = skill === "atry-self-review"
      ? "references/example-review.md"
      : "references/example-cross-review.md";
    const text = exampleText(skill, file);
    const cards = text.split("\n").filter((line) => line.startsWith("- Q"));
    expect(cards).toHaveLength(1);
    expect(text.match(/^ {2}- [ab]\. /gm)).toHaveLength(2);
    expect(text).toContain("\"open\": [");
  }
});

test("examples hold no secret and no real user data", () => {
  const forbidden = [/ghp_/, /sk-[A-Za-z0-9]/, /@[a-z0-9-]+\.(com|org|net)/i, /\/Users\//];
  for (const example of examples) {
    const text = exampleText(example.skill, example.file);
    for (const pattern of forbidden) expect(text).not.toMatch(pattern);
  }
});

test("each review example parses with the findings schema and names each id in the markdown", () => {
  for (
    const [skill, file] of [
      ["atry-self-review", "references/example-review.md"],
      ["atry-cross-review", "references/example-cross-review.md"],
    ] as const
  ) {
    const text = exampleText(skill, file);
    const jsonLine = text.split("\n").find((line) => line.startsWith("{ \"schema\""));
    const review = parseReviewJson(JSON.parse(jsonLine ?? ""));
    expect(review.findings.map((finding) => finding.status).sort()).toEqual(["fixed", "rejected"]);
    for (const finding of review.findings) {
      expect(text).toContain(`- ${finding.id}: `);
    }
    // The `review done` Acceptance check: one valid line per task, and known finding ids.
    const section = text.slice(
      text.indexOf("## Acceptance\n"),
      text.indexOf("`", text.indexOf("## Acceptance\n")),
    );
    const lines = section.split("\n").filter((line) => line.startsWith("- "));
    expect(lines.length).toBeGreaterThan(0);
    const ids = new Set(review.findings.map((finding) => finding.id));
    for (const line of lines) {
      const match = /^- (T[1-9]\d*): (met|unmet(?: F[1-9]\d*)+)$/.exec(line);
      expect(match, line).not.toBeNull();
      for (const id of match?.[2].split(" ").slice(1) ?? []) expect(ids.has(id), line).toBe(true);
    }
  }
});

test("no review skill file names fixed as a count", () => {
  for (const skill of ["atry-self-review", "atry-cross-review"]) {
    for (
      const file of ["SKILL.md", "references/reviewer-conduct.md", "references/file-conventions.md"]
    ) {
      expect(readFileSync(new URL(`../skills/${skill}/${file}`, import.meta.url), "utf8")).not
        .toMatch(/`fixed`( and|,| count)/);
    }
  }
});
