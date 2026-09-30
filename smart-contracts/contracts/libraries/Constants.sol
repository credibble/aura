// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Constants
/// @notice Every numeric constant in the Aura protocol, in one place:
///         fixed-point scales, fee basis points, the index scale, and the
///         fixed-point math constants. Reference as `Constants.ONE` etc.
library Constants {
    /// 1.0 at 18 decimals — the base fixed-point scale for all amounts/prices.
    uint256 internal constant ONE = 1e18;

    /// Fee basis points (10_000 = 100%).
    uint256 internal constant BPS = 10_000;

    /// The aura-index scale on-chain: 1e2, so 50.00 → 5000.
    uint256 internal constant INDEX_SCALE = 1e2;

    // --- fixed-point math constants ------------------------------------------

    /// ln(2).
    uint256 internal constant LN2 = 693147180559945309;

    /// log2(e).
    uint256 internal constant LOG2E = 1442695040888963407;
}
