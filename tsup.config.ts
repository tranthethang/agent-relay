import { defineConfig } from "tsup";

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
