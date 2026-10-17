import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("check runs dprint and tsc, and dprint loads the TypeScript plugin", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: { check: string };
  };
  expect(pkg.scripts.check).toContain("dprint check");
  expect(pkg.scripts.check).toContain("tsc --noEmit");

  const dprint = JSON.parse(readFileSync(new URL("../dprint.json", import.meta.url), "utf8")) as {
    plugins: string[];
  };
  expect(dprint.plugins.some((plugin) => plugin.includes("@dprint/typescript"))).toBe(true);
});
