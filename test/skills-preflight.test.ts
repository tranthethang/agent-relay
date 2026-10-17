import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { requiredVersion, requiresFits, sharedRequires } from "./skill-text.js";

const partial = readFileSync(new URL("../docs/partials/preflight.md", import.meta.url), "utf8");

test("preflight checks requires-atry against atry version --json", () => {
  expect(partial).toContain("requires-atry");
  expect(partial).toContain("atry version --json");
  expect(partial).toContain("JSON object with `schema` and `version`");
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
      "requires-atry: \">=0.1.0\"\n",
      "requires-atry: \">=0.1.1\"\n",
    ])
  ).toThrow("requires-atry values differ");
});

test("requires-atry uses X.M.Z and is not higher than the release", () => {
  expect(requiredVersion()).toBe("0.1.0");
  expect(requiresFits(">=0.1.0", "0.1.0")).toBe(true);
  expect(requiresFits(">=0.1.0", "0.10.0")).toBe(true);
  expect(requiresFits(">=0.11.0", "0.10.0")).toBe(false);
});
