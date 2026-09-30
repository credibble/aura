import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/ingestion/rss-parser";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>Bitcoin breaks $100k</title>
      <link>https://example.com/bitcoin</link>
      <guid>https://example.com/bitcoin</guid>
      <pubDate>Mon, 27 Sep 2026 12:00:00 GMT</pubDate>
      <dc:creator>Jane Doe</dc:creator>
      <enclosure url="https://example.com/img.png" type="image/png" length="0" />
      <media:content url="https://example.com/clip.mp4" type="video/mp4" medium="video" />
    </item>
    <item>
      <title>Second story</title>
      <link>https://example.com/second</link>
      <pubDate>Tue, 28 Sep 2026 08:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe("parseFeed", () => {
  const items = parseFeed(RSS, "fallback");

  it("extracts both items", () => {
    expect(items).toHaveLength(2);
  });

  it("maps title, url, author and date", () => {
    const first = items[0]!;
    expect(first.text).toBe("Bitcoin breaks $100k");
    expect(first.url).toBe("https://example.com/bitcoin");
    expect(first.author).toBe("Jane Doe");
    expect(first.publishedAt).toBe(Date.parse("Mon, 27 Sep 2026 12:00:00 GMT"));
  });

  it("falls back to the feed title as source name", () => {
    expect(items[1]!.sourceName).toBe("Example Feed");
  });

  it("extracts enclosure and media:content attachments", () => {
    const media = items[0]!.media;
    expect(media).toHaveLength(2);
    expect(media![0]).toEqual({ kind: "image", url: "https://example.com/img.png", title: undefined });
    expect(media![1]).toEqual({ kind: "video", url: "https://example.com/clip.mp4", title: undefined });
  });
});