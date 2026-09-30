import type { AdapterCredentials, AdapterSample, SourceConfig } from "../../core/domain/source";
import { BaseSource } from ".././base-source";
import { apiGetJson, bucketStart } from ".././http";

/**
 * LinkedIn adapter — an org/page's follower count via the LinkedIn API
 * (OIDC access token from the connection):
 *   followers — org followers (OrganizationalEntityFollowerStatistics)
 * Returns an empty sample without credentials.
 */
export class LinkedInConnectAdapter extends BaseSource {
  readonly platform = "linkedin";
  readonly weight = 850; // 1-1000 credibility
  readonly kind = "social" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = ["linkedin:accessToken"] as const;

  readonly metrics = [
    { key: "followers", label: "Followers", unit: "followers", higherIsBetter: true, source: "LinkedIn API /rest/organizationalEntityFollowerStatistics" },
  ];

  id(config: SourceConfig): string {
    return `linkedin-${this.str(config, "orgId") ?? this.str(config, "page") ?? this.str(config, "username") ?? "unknown"}`;
  }

  label(config: SourceConfig): string {
    return `LinkedIn — ${this.str(config, "page") ?? this.str(config, "username") ?? this.str(config, "orgId") ?? "unknown"}`;
  }

  async fetch(
    config: SourceConfig,
    _since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const token = credentials?.accessToken;
    const orgId = this.str(config, "orgId");
    if (!token || !orgId) return { points: {} };

    try {
      const stats = await apiGetJson(
        `https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A${encodeURIComponent(orgId)}`,
        { authorization: `Bearer ${token}`, "linkedin-version": "202402" },
      ) as {
        elements?: { followerGains?: { organicFollowerGain?: { followerDelta?: { value?: number } } } };
        firstDegreeSize?: { value?: number };
      };
      // firstDegreeSize is the org's follower count in the response.
      const followers = stats.firstDegreeSize?.value ?? 0;
      const t = bucketStart(now);
      return { points: { followers: [{ timestamp: t, value: followers }] } };
    } catch {
      return { points: {} };
    }
  }
}