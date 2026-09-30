import { XMLParser } from "fast-xml-parser";
import type { RawDatum, SourceMedia } from "../core/domain/source-item";

type XmlNode = Record<string, unknown>;

function asRecord(value: unknown): XmlNode {
  return (value ?? {}) as XmlNode;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function asArray(value: unknown): XmlNode[] {
  if (Array.isArray(value)) return value as XmlNode[];
  if (value && typeof value === "object") return [asRecord(value)];
  return [];
}

function firstString(node: XmlNode, ...keys: string[]): string {
  for (const key of keys) {
    const v = node[key];
    const s = asString(typeof v === "object" ? asRecord(v)["#text"] : v).trim();
    if (s) return s;
  }
  return "";
}

/** Minimal RSS/Atom → RawDatum[]. Handles the common shapes (item/entry, guid/link, pubDate). */
export function parseFeed(xml: string, fallbackSourceName: string): RawDatum[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = asRecord(parser.parse(xml));
  const channel = asRecord(doc.rss ? asRecord(doc.rss).channel : doc.feed);
  const feedTitle = firstString(channel, "title", "dc:title") || fallbackSourceName;

  const rawItems: XmlNode[] = asArray(channel.item).length
    ? asArray(channel.item)
    : asArray(channel.entry);

  return rawItems
    .map((item): RawDatum | null => {
      const text = firstString(item, "title", "media:title");
      if (!text) return null;
      const url = firstString(item, "link", "guid");
      const pubDate = firstString(item, "pubDate", "published", "updated");
      const author = firstString(item, "dc:creator");
      const id = firstString(item, "guid") || url || text;
      return {
        id: id || undefined,
        sourceName: author || feedTitle,
        text,
        url: url.startsWith("http") ? url : undefined,
        author: author || undefined,
        publishedAt: pubDate ? parseDate(pubDate) : Date.now(),
        media: extractMedia(item),
      };
    })
    .filter((r): r is RawDatum => r !== null);
}

/**
 * Pull images/videos out of an item. News feeds are inconsistent: some use
 * `<enclosure>`, most use `<media:content>` / `<media:thumbnail>`, and plenty only
 * embed an `<img src>` inside `<content:encoded>`/`<description>` HTML. Without
 * the last two the feed cards had no artwork at all.
 */
function extractMedia(item: XmlNode): SourceMedia[] | undefined {
  const out: SourceMedia[] = [];
  const push = (kind: "image" | "video", url: string, title?: string) => {
    const clean = url.trim();
    if (!clean.startsWith("http") || out.some((m) => m.url === clean) || out.length >= 4) return;
    out.push({ kind, url: clean, title: title || undefined });
  };

  const collect = (value: unknown, bag: unknown[]) => {
    if (Array.isArray(value)) bag.push(...value);
    else if (value && typeof value === "object") bag.push(value);
  };
  const candidates: unknown[] = [];
  collect(item.enclosure, candidates);
  collect(item["media:content"], candidates);
  collect(item["media:thumbnail"], candidates);

  for (const raw of candidates) {
    const node = asRecord(raw);
    // fast-xml-parser namespaces attributes as "@_attr".
    const url = asString(node["@_url"] ?? node.url).trim();
    const type = asString(node["@_type"] ?? node.type).toLowerCase();
    if (type.startsWith("audio")) continue;
    push(type.startsWith("video") ? "video" : "image", url, asString(node["@_title"] ?? node.title));
  }

  // Last resort: the first <img> in the item's HTML body.
  if (out.length === 0) {
    const html = asString(item["content:encoded"] ?? item.description ?? item.summary);
    const src = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
    if (src) {
      const title = asString(item.title ?? item["media:title"]) || undefined;
      push("image", src, title);
    }
  }
  return out.length ? out : undefined;
}

function parseDate(value: string): number {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Date.now();
}