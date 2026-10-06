import { defineConfig } from "vitest/config";

// Unit tests only. End-to-end and load tests run against a live server (see tests/e2e).
export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"] },
});
