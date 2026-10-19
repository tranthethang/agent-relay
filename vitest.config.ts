import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // CLI tests spawn `node dist/atry.js` many times per test.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      autoAttachSubprocess: true,
      excludeAfterRemap: true,
      reporter: ["json"],
      reportsDirectory: "coverage",
      // dist/atry.js stays in the raw report so the coverage script can apply its source map.
      include: [
        "src/**/*.ts",
        "scripts/maint/**/*.ts",
        "tsup.config.ts",
        "vitest.config.ts",
        "dist/atry.js",
      ],
      exclude: [
        "test/**",
        "**/*.test.ts",
        "node_modules/**",
        "coverage/**",
      ],
    },
  },
});
