import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";

const SHARED = realpathSync(resolve(__dirname, "shared"));

// Two suites, both run from this package: the extension's shared unit tests (the exact files the
// app bundles, through the shared/ link) and the Android shell tests (storage, messages, ports,
// fetch rules, site browser helpers) with the native plugins replaced by fakes.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    projects: [
      {
        server: { fs: { allow: [SHARED, __dirname] } },
        test: {
          name: "shared",
          root: SHARED,
          environment: "node",
          include: ["test/**/*.test.ts"],
          pool: "forks",
          setupFiles: [resolve(__dirname, "test/shared-cwd.ts"), resolve(SHARED, "test/setup.ts")],
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "mobile",
          root: __dirname,
          environment: "happy-dom",
          include: ["test/**/*.test.ts"],
          exclude: ["test/e2e/**"],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
