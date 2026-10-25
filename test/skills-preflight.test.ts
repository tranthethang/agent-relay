import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  requiredVersion,
  requiresFits,
  sharedRequires,
  skillMinimumRange,
  skillMinimumVersion,
} from "./skill-text.js";

const olderThanFloor = "0.1.0";
const partial = readFileSync(
  new URL("../specs/80-skills-integration/00-skill-bridge/preflight.md", import.meta.url),
  "utf8",
);

test("preflight asks for atry preflight and context", () => {
  expect(partial).toContain("requires-atry");
  expect(partial).toContain("atry preflight --requires");
  expect(partial).toContain("exits non-zero");
  expect(partial).toContain("unknown command");
  expect(partial).toContain("npm i -g @tranthethang/agent-relay@latest");
  expect(partial).toContain("atry context <run> --json");
  expect(partial).not.toContain("atry version --json");
  expect(partial).not.toMatch(/\b(mktemp|trap|heredoc|grep|sed)\b/);
  expect(partial).not.toContain("```");
  expect(partial).not.toContain("verify.sh");
});

test("preflight points at file conventions and explains dev builds", () => {
  expect(partial).toContain("Read `references/file-conventions.md` before you edit a run file.");
  expect(partial).toContain("--allow-dev");
  expect(partial).toContain("ATRY_DEV=1");
  expect(partial).toContain("do not use a dev build for a real run");
  expect(partial).toContain(
    "A claim result with `worktree.path` takes precedence over `run.worktree.path`.",
  );
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
  expect(requiredVersion()).toBe(skillMinimumVersion);
  expect(requiresFits(skillMinimumRange, skillMinimumVersion)).toBe(true);
  expect(requiresFits(skillMinimumRange, olderThanFloor)).toBe(false);
  expect(requiresFits(">=99.1.0", skillMinimumVersion)).toBe(false);
});
