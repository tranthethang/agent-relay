import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { isDevVersion, packageVersion, versionText } from "../src/version.js";
import { runCli, withTempDir, withTempGitRepo } from "./helper.js";

// `npm test` builds first, so the version next to the bundle is the dev build.
const built = JSON.parse(
  readFileSync(new URL("../dist/package.json", import.meta.url), "utf8"),
) as {
  version: string;
};

test("atry version prints the dev version and a dev marker", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["version"], dir);
    expect(result.code).toBe(0);
    expect(built.version).toContain("dev");
    expect(result.stdout).toBe(`${built.version}\ndev build\n`);
    expect(result.stderr).toBe("");
  });
});

test("atry version --json prints schema 1", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["version", "--json"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify({ schema: 1, version: built.version })}\n`);
    expect(result.stderr).toBe("");
  });
});

test("packageVersion reads the file next to the module first", async () => {
  await withTempDir(async (dir) => {
    const dist = join(dir, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(join(dir, "package.json"), `${JSON.stringify({ version: "1.12.3" })}\n`);
    await writeFile(join(dist, "package.json"), `${JSON.stringify({ version: "2.1.0" })}\n`);
    const moduleUrl = pathToFileURL(join(dist, "atry.js")).href;
    expect(packageVersion(moduleUrl)).toBe("2.1.0");
    await writeFile(join(dist, "package.json"), "{ not json\n");
    expect(packageVersion(moduleUrl)).toBe("1.12.3");
    await rm(join(dist, "package.json"));
    expect(packageVersion(moduleUrl)).toBe("1.12.3");
  });
});

test("a release version prints no dev marker", () => {
  expect(isDevVersion("1.12.3")).toBe(false);
  expect(isDevVersion("1.12.3-dev")).toBe(true);
  expect(versionText("1.12.3")).toBe("1.12.3\n");
  expect(versionText("1.12.3-dev")).toBe("1.12.3-dev\ndev build\n");
});
