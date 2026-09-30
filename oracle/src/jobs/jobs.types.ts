export interface AuraHandle {
  /** bytes32 hex of the handleId. */
  id: string;
  /** ASCII label ("btc", "devar"). */
  label: string;
  /** Handle contract address. */
  contract: string;
  /** On-chain source JSON configs (adapter configs). */
  sources: string[];
  /** Current on-chain aura (1e2-scaled). */
  aura: number;
  graduated: boolean;
  /**
   * Market-style category codes (`{cat}_{sub}_{format}`). A handle can belong to
   * more than one family — e.g. @ronaldo is sport/football AND people. The FIRST
   * entry is the primary one that decides the window's market style.
   */
  categories: number[];
  windowMinutes: number;
  /** On-chain Handle metadata JSON string (name/label/photo/…). */
  metadata?: string;
}

export interface AuraSlot {
  /** Epoch ms bucket start (aligned to the scheduler interval). */
  now: number;
  bucketSec: number;
}

export interface FeedSlot {
  now: number;
  bucketSec: number;
}

export interface WindowSlot {
  now: number;
}