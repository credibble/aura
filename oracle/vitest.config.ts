import { defineConfig } from "vitest/config";

/**
 * Unit tests by default (fast, no dependencies). The e2e suite boots the real
 * Nest application and is run separately:
 *
 *   npm test        → test/**\/*.test.ts
 *   npm run test:e2e → test/e2e/**\/*.e2e-spec.ts
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**", "node_modules/**"],
    environment: "node",
  },
});
