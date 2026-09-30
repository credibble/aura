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

/** Pull images/videos from <enclosure> and <media:content>. */
function extractMedia(item: XmlNode): SourceMedia[] | undefined {
  const out: SourceMedia[] = [];
  const enclosure = item.enclosure;
  const mediaContent = item["media:content"];
  const candidates: unknown[] = [];
  if (Array.isArray(enclosure)) candidates.push(...enclosure);
  else if (enclosure && typeof enclosure === "object") candidates.push(enclosure);
  if (Array.isArray(mediaContent)) candidates.push(...mediaContent);
  else if (mediaContent && typeof mediaContent === "object") candidates.push(mediaContent);

  for (const raw of candidates) {
    const node = asRecord(raw);
    // fast-xml-parser namespaces attributes as "@_attr".
    const url = asString(node["@_url"] ?? node.url).trim();
    if (!url.startsWith("http")) continue;
    const type = asString(node["@_type"] ?? node.type).toLowerCase();
    const kind = type.startsWith("video") ? "video" : type.startsWith("audio") ? undefined : "image";
    if (!kind) continue;
    if (out.length >= 4) break;
    out.push({ kind, url, title: asString(node["@_title"] ?? node.title) || undefined });
  }
  return out.length ? out : undefined;
}

function parseDate(value: string): number {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Date.now();
}