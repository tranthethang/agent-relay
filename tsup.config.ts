import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";
import { skillMinimumVersion } from "./scripts/maint/next-version.ts";

// The repo `package.json` stays at 0.0.0, so a local build would fail the skill
// preflight. The release workflow sets a real version before the build.
const root = dirname(fileURLToPath(import.meta.url));
const repoVersion = (
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string }
).version;
const isRelease = repoVersion !== undefined && repoVersion !== "0.0.0";
const buildVersion = isRelease ? repoVersion : `${skillMinimumVersion}-dev`;

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(
  join(root, "dist", "package.json"),
  `${JSON.stringify({ version: buildVersion, type: "module" })}\n`,
);

export default defineConfig({
  entry: {
    atry: "src/cli.ts",
  },
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  target: "node22",
  splitting: false,
  sourcemap: true,
  clean: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
