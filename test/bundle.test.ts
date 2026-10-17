import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("tsconfig is strict and tsup writes one dist/atry.js bundle", () => {
  const tsconfig = JSON.parse(
    readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8"),
  ) as {
    compilerOptions: { strict: boolean; noEmit: boolean };
  };
  expect(tsconfig.compilerOptions.strict).toBe(true);
  expect(tsconfig.compilerOptions.noEmit).toBe(true);

  // `npm test` builds first (pretest). Do not rebuild here: other test files spawn dist/atry.js in parallel.
  expect(existsSync(new URL("../dist/atry.js", import.meta.url))).toBe(true);

  const run = spawnSync(process.execPath, ["dist/atry.js"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  expect(run.status).not.toBeNull();
});
