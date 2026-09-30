import type { Source } from "../domain/source";

export interface SourceRegistry {
  all(): Promise<Source[]>;
  get(id: string): Promise<Source | null>;
  /** Sources whose fetch interval has elapsed since their last fetch. */
  ready(now: number): Promise<Source[]>;
  /** Record that a source was fetched at `at`. */
  markFetched(id: string, at: number): Promise<void>;
  /** Last fetch time for a source, or undefined if never fetched. */
  lastFetchedAt(id: string): Promise<number | undefined>;
  /** Every handle id that allows this source. */
  handlesForSource(sourceId: string): Promise<string[]>;
}