/** Shared test helpers. */

/** Encode a left-aligned ASCII handleId the same way the chain does. */
export function encodeBytes32(s: string): string {
  return "0x" + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");
}