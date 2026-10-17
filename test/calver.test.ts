import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const unpadded = /^[0-9]{2}\.(1[0-2]|[1-9])\.([1-9]|[12][0-9]|3[01])$/;

test("VERSION, package.json, and the release docs use unpadded CalVer", () => {
  const version = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  expect(version).toMatch(unpadded);
  expect(pkg.version).toBe(version);

  const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
  const release = readFileSync(new URL("../docs/release.md", import.meta.url), "utf8");
  expect(agents).toContain("`YY.M.D`");
  expect(agents).not.toContain("zero-padded");
  expect(release).toContain("`YY.M.D`");
  expect(release).not.toContain("zero-padded");
});
