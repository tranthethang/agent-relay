import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { requiresFits, sharedRequires } from "./skill-text.js";

const partial = readFileSync(new URL("../docs/partials/preflight.md", import.meta.url), "utf8");

test("preflight checks requires-atry against atry version --json", () => {
  expect(partial).toContain("requires-atry");
  expect(partial).toContain("atry version --json");
  expect(partial).toContain("npm i -g @tranthethang/agent-relay@latest");
  expect(partial).toContain("atry context <run> --json");
  expect(partial).not.toMatch(/\b(mktemp|trap|heredoc|grep|sed)\b/);
  expect(partial).not.toContain("```");
  expect(partial).not.toContain("verify.sh");
  expect(partial).not.toContain("file-conventions");
});

test("requires-atry values must match", () => {
  expect(() =>
    sharedRequires([
      "requires-atry: \">=26.10.17\"\n",
      "requires-atry: \">=26.10.18\"\n",
    ])
  ).toThrow("requires-atry values differ");
});

test("requires-atry must not be higher than VERSION", () => {
  expect(requiresFits(">=26.10.17", "26.10.17")).toBe(true);
  expect(requiresFits(">=26.10.16", "26.10.17")).toBe(true);
  expect(requiresFits(">=26.11.1", "26.10.17")).toBe(false);
});
