import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("npm release checks CalVer and publishes latest with provenance", () => {
  const yaml = readFileSync(
    new URL("../.github/workflows/npm-release.yml", import.meta.url),
    "utf8",
  );
  expect(yaml).toContain("id-token: write");
  expect(yaml).toContain("npm publish --provenance --access public --tag latest");
  expect(yaml).toContain("package.json");
  expect(yaml).toContain("VERSION");
  expect(yaml).toContain("YY.M.D");
  expect(yaml).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
  expect(yaml).toContain("npm view");
  expect(yaml).toContain("steps.published.outputs.already != 'true'");
  expect(yaml).not.toContain("trusted publishing");
});
