import { defineConfig } from "vitest/config";

/** e2e config — boots the real app; run with `npm run test:e2e`. */
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e-spec.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One app instance at a time: the suite shares process-level env vars.
    fileParallelism: false,
    // Forks isolate the Nest bootstrap (RPC/Redis native handles) from vitest's
    // worker pool — a crash there would otherwise take the runner down.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
