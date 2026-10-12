/**
 * Pure TanStack Start + Vite. No wrapper config: every plugin below is one the
 * app declares itself, so what runs is what is written here.
 *
 *   - tailwindcss     → Tailwind 4 (CSS-first, no tailwind.config)
 *   - tanstackStart   → Start's server/SSR pipeline, file-based routes
 *                       (`src/routes` → `src/routeTree.gen.ts`), the server
 *                       entry (`src/server.ts`, our SSR error wrapper)
 *   - nitro           → the deploy adapter. TanStack Start itself only emits an
 *                       SSR bundle (`dist/client` + `dist/server`); Nitro turns
 *                       that into a runnable server target. On Vercel (`VERCEL`
 *                       is set at build time) it emits the Build Output API to
 *                       `.vercel/output`; elsewhere it defaults to a Node server
 *                       in `.output`. Without it the deploy has no server
 *                       function and every route 404s.
 *   - viteReact       → React fast refresh + JSX
 *
 * Order matters: Start's plugin runs before Nitro, which runs before React.
 */
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
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
    // Vercel preset is auto-detected from the VERCEL env var at build time.
    nitro(),
    viteReact(),
  ],
});
