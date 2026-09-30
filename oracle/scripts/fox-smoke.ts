import { FoxSportsAdapter, FOX_SPORTS_SOCCER_FEED } from "../src/adapters/foxsports.adapter";

const a = new FoxSportsAdapter();
console.log("feed:", FOX_SPORTS_SOCCER_FEED.slice(0, 90) + "...");
const s = await a.fetch({ platform: "foxsports" }, Date.now() - 7 * 24 * 3600 * 1000, Date.now());
console.log("items:", s.items.length);
console.log("first:", s.items[0]?.text?.slice(0, 80), "| ts:", s.items[0]?.publishedAt);
console.log("articles:", s.points.articles?.[0]?.value, "coverage:", s.points.coverage?.[0]?.value);