import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // CLI tests spawn `node dist/atry.js` many times per test.
    testTimeout: 20_000,
  },
});
