/**
 * One-off codemod: route `social.service.ts` read catches through
 * `this.dbFallback("<op>", fallback, error)` so a DB outage is loud in
 * production instead of looking like "no data".
 *
 * Only the sites where an empty/false fallback MASQUERADES as real data are
 * touched; deliberate `return false` failure signals are left alone.
 */
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "src/social/social.service.ts";
const src = readFileSync(PATH, "utf8");

/** Operations to convert: [enclosing method, exact catch body] */
const TARGETS = [
  ["comments", "return { items: [], total: 0 };"],
  ["notifications", "return { items: [], total: 0 };"],
  ["bookmarkedPosts", "return { items: [], total: 0 };"],
  ["repostedPosts", "return { items: [], total: 0 };"],
  ["incrementViews", "return null;"],
  ["isLiked", "return this.localLikes.has(likeKey(userId, targetId, targetType));"],
  ["isReposted", "return this.localReposts.has(repostKey(userId, eventId));"],
  ["isBookmarked", "return this.localBookmarks.has(bookmarkKey(userId, postId));"],
];

let out = src;
let converted = 0;
const seen = new Map();

for (const [method, body] of TARGETS) {
  // Find the method's span so the replacement only applies inside it.
  const methodRx = new RegExp(`(\\n  (?:async )?${method}\\()`, "g");
  const starts = [...out.matchAll(methodRx)].map((m) => m.index + 1);
  if (starts.length !== 1) {
    console.log(`  ! ${method}: found ${starts.length} declarations — skipped`);
    continue;
  }
  const start = starts[0];
  const nextDecl = out.slice(start + 1).search(/\n  (?:async )?[A-Za-z]+\(/);
  const end = nextDecl === -1 ? out.length : start + 1 + nextDecl;
  const span = out.slice(start, end);

  const catchRx = new RegExp(`\\} catch \\{\\s*\\n(\\s*)${body.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n(\\s*)\\}`, "");
  if (!catchRx.test(span)) {
    console.log(`  ! ${method}: no matching catch block — skipped`);
    continue;
  }
  const replacedSpan = span.replace(
    catchRx,
    (_m, ind) => `} catch (error) {\n${ind}return this.dbFallback("${method}", ${body.replace(/;$/, "")}, error);\n${ind.replace(/\s{2}$/, "")}}`,
  );
  out = out.slice(0, start) + replacedSpan + out.slice(end);
  converted += 1;
  seen.set(method, true);
  console.log(`  ✓ ${method}`);
}

writeFileSync(PATH, out);
console.log(`\nconverted ${converted}/${TARGETS.length} sites\n`);
