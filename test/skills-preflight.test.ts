import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

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
