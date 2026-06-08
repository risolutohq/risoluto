import { defineConfig } from "vitest/config";

// E2E intake tier (verification ladder, Layer 2). Drives a real intake adapter end to end, faking only
// the true externals. Kept under its own config + `test:e2e` script so it gates CI without bloating the
// default unit suite (`vitest.config.ts` excludes `tests/e2e/**`).
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    environment: "node",
    setupFiles: ["tests/helpers/quarantine.ts"],
    retry: 1,
  },
});
