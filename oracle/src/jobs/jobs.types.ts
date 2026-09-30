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
  /** Market-style category code (e.g. 100_001_001 = sport/football/binary). */
  category: number;
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