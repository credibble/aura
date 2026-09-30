import type { AdapterCredentials, AdapterSample, SourceConfig } from "../../core/domain/source";
import { BaseSource } from ".././base-source";
import { apiGetJson, bucketStart, iso } from ".././http";

/**
 * Shopify adapter — a merchant store's commerce metrics via the Shopify Admin
 * API (OAuth access token from the connection; merchant grants read_orders,
 * read_customers, read_products, read_inventory):
 *   sales     — revenue since `since` (GraphQL Admin API, Σ currentTotalPrice)
 *   orders    — order count in the window (orders/count)
 *   customers — new customers in the window (customers/count)
 *   products  — product count (products/count)
 * Returns an empty sample without credentials.
 */
export class ShopifyConnectAdapter extends BaseSource {
  readonly platform = "shopify";
  readonly weight = 750; // 1-1000 credibility
  readonly kind = "search" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = ["shopify:accessToken"] as const;

  readonly metrics = [
    { key: "sales", label: "Sales", unit: "$", higherIsBetter: true, source: "Shopify GraphQL Admin /orders" },
    { key: "orders", label: "Orders", unit: "orders", higherIsBetter: true, source: "Shopify Admin /orders/count" },
    { key: "customers", label: "New Customers", unit: "customers", higherIsBetter: true, source: "Shopify Admin /customers/count" },
    { key: "products", label: "Products", unit: "products", higherIsBetter: true, source: "Shopify Admin /products/count" },
  ];

  id(config: SourceConfig): string {
    return `shopify-${this.shop(config)}`;
  }

  label(config: SourceConfig): string {
    return `${this.str(config, "label") ?? "Store"} — ${this.shop(config)}`;
  }

  private shop(config: SourceConfig): string {
    return this.str(config, "shop") ?? this.str(config, "store") ?? this.str(config, "username") ?? "unknown";
  }

  async fetch(
    config: SourceConfig,
    since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const token = credentials?.accessToken ?? credentials?.apiKey;
    const shop = this.shop(config);
    if (!token) return { points: {} };

    try {
      const base = `https://${shop}.myshopify.com/admin/api/2024-01`;
      const headers = { "X-Shopify-Access-Token": token, "content-type": "application/json" };
      const sinceIso = iso(since);

      // Revenue — GraphQL Admin API (Shopify's recommended path).
      const revenue = await this.graphqlSales(base, headers, sinceIso);

      // Counts — REST count endpoints (reliable, cheap).
      const orders = await this.count(`${base}/orders/count.json?status=any&created_at_min=${sinceIso}`, headers);
      const customers = await this.count(`${base}/customers/count.json?created_at_min=${sinceIso}`, headers);
      const products = await this.count(`${base}/products/count.json`, headers);

      const t = bucketStart(now);
      return {
        points: {
          sales: [{ timestamp: t, value: revenue }],
          orders: [{ timestamp: t, value: orders }],
          customers: [{ timestamp: t, value: customers }],
          products: [{ timestamp: t, value: products }],
        },
      };
    } catch {
      return { points: {} };
    }
  }

  private async graphqlSales(base: string, headers: Record<string, string>, sinceIso: string): Promise<number> {
    const query = `query($q: String!) { orders(first: 250, query: $q) { edges { node { currentTotalPrice } } } }`;
    const res = await fetch(`${base}/graphql.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables: { q: `created_at:>=${sinceIso}` } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`shopify gql HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { orders?: { edges?: { node?: { currentTotalPrice?: string } }[] } }; errors?: unknown };
    if (json.errors) throw new Error("shopify gql errors");
    return (json.data?.orders?.edges ?? []).reduce((acc, e) => acc + Number(e.node?.currentTotalPrice ?? 0), 0);
  }

  private async count(url: string, headers: Record<string, string>): Promise<number> {
    const res = await apiGetJson(url, headers) as { count?: number };
    return res.count ?? 0;
  }
}