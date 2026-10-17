import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("npm release checks CalVer and publishes next with provenance", () => {
  const yaml = readFileSync(
    new URL("../.github/workflows/npm-release.yml", import.meta.url),
    "utf8",
  );
  expect(yaml).toContain("id-token: write");
  expect(yaml).toContain("npm publish --provenance --access public --tag next");
  expect(yaml).toContain("package.json");
  expect(yaml).toContain("VERSION");
  expect(yaml).toContain("YY.M.D");
  expect(yaml).not.toContain("NPM_TOKEN");
  expect(yaml).not.toContain("NODE_AUTH_TOKEN");
});
