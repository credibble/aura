/**
 * Pure TanStack Start + Vite. No wrapper config: every plugin below is one the
 * app declares itself, so what runs is what is written here.
 *
 *   - tsConfigPaths   → the `@/*` alias from tsconfig.json
 *   - tailwindcss     → Tailwind 4 (CSS-first, no tailwind.config)
 *   - tanstackStart   → Start's server/SSR pipeline, file-based routes
 *                       (`src/routes` → `src/routeTree.gen.ts`), the server
 *                       entry (`src/server.ts`, our SSR error wrapper)
 *   - viteReact       → React fast refresh + JSX
 *
 * Order matters: Start's plugin runs before the React one.
 */
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // 5173, not 8080: the indexer's Hasura console and GraphQL API own 8080
  // (see indexer/README.md), and the two must not fight for it.
  server: { port: 5173, strictPort: true },
  // Vite resolves tsconfig `paths` itself now (`@/*` → `./src/*`), so no
  // vite-tsconfig-paths plugin is needed.
  resolve: {
    tsconfigPaths: true,
    // One copy of React and the shared runtime libraries — a second copy (from a
    // transitive dep) breaks hooks and context in ways that look like app bugs.
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
  plugins: [
    tailwindcss(),
    // `entry` is relative to src/, so `server` → src/server.ts.
    tanstackStart({ start: { entry: "server" } }),
    viteReact(),
  ],
});
