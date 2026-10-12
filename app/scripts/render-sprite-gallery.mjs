/**
 * Renders every character archetype (each primary category + brand override +
 * pose variant) into a self-contained HTML gallery so the sprites can be eyeballed
 * without a wallet, an RPC, or the map. Uses esbuild to bundle a tiny React
 * entry that mounts `CharacterSprite` for each case.
 *
 *   node scripts/render-sprite-gallery.mjs [outfile]
 */
import esbuild from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const cases = [
  ["crypto", undefined, "Coin (crypto)"],
  ["ai", undefined, "Bot (ai)"],
  ["sports", undefined, "Footballer A (sports)"],
  ["sports", undefined, "Footballer B (sports)"],
  ["sports", undefined, "Footballer C (sports)"],
  ["music", undefined, "Singer A (music)"],
  ["music", undefined, "Singer B (music)"],
  ["music", undefined, "Singer C (music)"],
  ["people", undefined, "Person (people)"],
  ["brands", undefined, "Founder A (brands)"],
  ["brands", undefined, "Founder B (brands)"],
  ["memes", undefined, "Cat (memes)"],
  ["tech", undefined, "Controller (tech)"],
  ["culture", undefined, "Popcorn (culture)"],
  ["brands", "Tesla", "Car (brand override)"],
  ["brands", "Apple", "Phone (brand override)"],
  ["brands", "Nike", "Sneaker (brand override)"],
  ["brands", "Amazon", "Box (brand override)"],
  ["brands", "SpaceX", "Rocket (brand override)"],
  ["tech", "Tesla", "Tesla elsewhere — SAME car (per-handle)"],
  ["crypto", "Bitcoin", "Coin — Bitcoin orange"],
  ["crypto", "Ethereum", "Coin — Ethereum blue"],
  ["crypto", "Solana", "Coin — Solana purple→green"],
  ["sports", "Lionel Messi", "Footballer — Argentina kit"],
  ["sports", "Ronaldo", "Footballer — Portugal kit"],
  ["music", "Taylor Swift", "Singer — long hair (female)"],
];

const ids = [
  "0xhandle000aaa", "0xhandle001bbb", "0xhandle002ccc", "0xhandle003ddd",
  "0xhandle004eee", "0xhandle005fff", "0xhandle006ggg", "0xhandle007hhh",
  "0xhandle008iii", "0xhandle009jjj", "0xhandle010kkk", "0xhandle011lll",
  "0xhandle012mmm", "0xhandle013nnn", "tesla", "apple", "nike", "amazon",
  "spacex", "0xhandle020ppp", "btc", "eth", "sol", "messi", "cr7", "taylor",
];

const entry = `
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CharacterSprite } from "@/components/aura/CharacterSprite";

const cases = ${JSON.stringify(cases.map((c, i) => [...c, ids[i]]))};
document.getElementById("grid").innerHTML = cases
  .map(([district, name, label, id]) => {
    const svg = renderToStaticMarkup(React.createElement(CharacterSprite, { id, name, category: district }));
    return "<figure><div class=\\"stage\\">" + svg + "</div><figcaption>" + label + "<br><code>" + id + "</code></figcaption></figure>";
  })
  .join("");
`;

const bundle = await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx", sourcefile: "gallery-entry.tsx" },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@": resolve(root, "src") },
  platform: "browser",
  target: "es2020",
  logLevel: "error",
});

const out = resolve(process.argv[2] ?? resolve(tmpdir(), "aura-sprite-gallery.html"));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>Aura archetype sprites</title>
<style>
  body { background:#F6F3EC; color:#2E3440; font:14px/1.4 system-ui, sans-serif; margin:24px; }
  h1 { font-size:18px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:16px; }
  figure { margin:0; text-align:center; }
  .stage { width:128px; height:128px; margin:0 auto; filter: drop-shadow(0 6px 6px rgba(46,52,64,.25)); }
  .stage svg { width:128px; height:128px; }
  figcaption { margin-top:6px; font-size:12px; color:#5A6472; }
  figcaption code { font-size:10px; color:#8B95A1; }
</style>
<h1>Aura archetype villagers — one character per handle (primary category) + brand overrides</h1>
<div class="grid" id="grid"></div>
<script>${bundle.outputFiles[0].text}</script>`,
);
console.log(out);
