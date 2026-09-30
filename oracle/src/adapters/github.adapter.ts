import type { AdapterCredentials, AdapterSample, SourceConfig } from "../core/domain/source";
import { BaseSource } from "./base-source";
import { apiGetJson, bucketStart } from "./http";

/**
 * GitHub adapter — a user/org's own metrics via the GitHub REST API (free,
 * higher rate-limit with a token from the connection):
 *   followers — user followers
 *   stars     — Σ stargazers across their repos
 *   repos     — public repo count
 */
export class GitHubAdapter extends BaseSource {
  readonly platform = "github";
  readonly weight = 800; // 1-1000 credibility
  readonly kind = "community" as const;
  readonly fetchIntervalMs = 5 * 60_000;
  readonly requiredCredentials = ["github:token"] as const;

  readonly metrics = [
    { key: "followers", label: "Followers", unit: "followers", higherIsBetter: true, source: "GitHub API /users/{login}" },
    { key: "stars", label: "Stars", unit: "stars", higherIsBetter: true, source: "GitHub API /users/{login}/repos" },
    { key: "repos", label: "Repos", unit: "repos", higherIsBetter: true, source: "GitHub API /users/{login}" },
  ];

  id(config: SourceConfig): string {
    return `github-${this.str(config, "username") ?? "unknown"}`;
  }

  label(config: SourceConfig): string {
    return `GitHub — ${this.str(config, "username") ?? "unknown"}`;
  }

  async fetch(
    config: SourceConfig,
    _since: number,
    now: number,
    credentials?: AdapterCredentials,
  ): Promise<AdapterSample> {
    const login = this.str(config, "username") ?? "unknown";
    const headers: Record<string, string> = { accept: "application/vnd.github+json" };
    if (credentials?.accessToken ?? credentials?.apiKey) headers.authorization = `Bearer ${credentials?.accessToken ?? credentials?.apiKey}`;

    try {
      const user = await apiGetJson(`https://api.github.com/users/${encodeURIComponent(login)}`, headers) as {
        followers?: number;
        public_repos?: number;
      };
      const repos = await apiGetJson(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=updated`, headers) as {
        stargazers_count?: number;
      }[];
      const t = bucketStart(now);
      return {
        points: {
          followers: [{ timestamp: t, value: user.followers ?? 0 }],
          stars: [{ timestamp: t, value: repos.reduce((acc, r) => acc + (r.stargazers_count ?? 0), 0) }],
          repos: [{ timestamp: t, value: user.public_repos ?? 0 }],
        },
      };
    } catch {
      return { points: {} };
    }
  }
}