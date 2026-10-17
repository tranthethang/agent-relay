import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("CI runs check, build, and test on ubuntu, macos, and windows", () => {
  const yaml = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  expect(yaml).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
  expect(yaml).toContain("npm run check");
  expect(yaml).toContain("npm run build");
  expect(yaml).toContain("npm test");
});
