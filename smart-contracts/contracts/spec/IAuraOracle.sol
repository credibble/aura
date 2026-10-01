// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Aura Oracle interface
/// @notice The single trusted resolution authority for ONE (handleId,
///         windowStart) market window. Every window has its own oracle contract
///         carrying its own handleId/windowStart.
///         Mirrors the shared spec in `packages/contracts/src/receipt.ts`
///         (EIP-712 typed data).
interface IAuraOracle {
    /// The signed payload the relayer submits. All fractional numbers are
    /// fixed-point scaled by PRICE_SCALE (10_000).
    struct ResolutionReceipt {
        bytes32 handleId;
        uint256 windowStart;
        uint256 windowEnd;
        uint256 s; // S_t
        uint256 expectation; // E_t
        int256 delta; // ΔS_t (signed)
        uint256 indexOpen;
        uint256 indexClose;
        bool direction; // true = up
        uint32 itemCount;
        bytes32 outcomesHash; // keccak commitment to the ordered outcome metadata (binary markets)
        uint256 resolvedAt;
    }

    /// The on-chain lifecycle of a (handleId, windowStart) market window.
    /// RESOLVED is the FREEZE signal: the MarketMaker refuses trading the moment
    /// a window's oracle is RESOLVED, even if the scheduled `windowEnd` is still
    /// ahead — the outcome (and winner) is public from that block on.
    enum WindowStatus {
        OPEN, // trading allowed
        FROZEN, // trading locked; awaiting resolution
        RESOLVED, // resolved from a signed receipt — trading frozen, settles next
        VOIDED // no resolution — market voided and refunded
    }

    // --- events ---------------------------------------------------------------
    event WindowOpened(bytes32 indexed handleId, uint256 windowStart, uint256 windowEnd);

    event WindowConfirmed(uint256 windowEnd, string metadata);

    event WindowFrozen(bytes32 indexed handleId, uint256 windowStart);

    event WindowResolved(bytes32 indexed handleId, uint256 windowStart, bool direction, uint256 indexClose, bytes32 resolutionHash);

    event WindowVoided(bytes32 indexed handleId, uint256 windowStart, string reason);

    // --- views ----------------------------------------------------------------
    /// The handle and window this oracle is bound to (immutable identity).
    function handleId() external view returns (bytes32);

    function windowStart() external view returns (uint256);

    /// The oracle IS the window — no (handleId, windowStart) params needed.
    function windowStatus() external view returns (WindowStatus);

    /// The window's confirmed end (0 = never confirmed).
    function windowEnd() external view returns (uint256);

    function resolutionOf()
        external
        view
        returns (bool direction, uint256 indexClose, bytes32 resolutionHash, uint256 resolvedAt);

    function receiptDigest(ResolutionReceipt calldata receipt) external view returns (bytes32);

    // --- actions --------------------------------------------------------------
    /// Confirm the window's real end + canonical metadata (the MarketMaker relays
    /// it at open). One-shot; also overwrites squatter-set metadata.
    function confirmWindow(uint256 windowEnd, string calldata metadata) external;

    function freezeWindow() external;

    /// Verify the oracle signature and resolve the window exactly once. May run
    /// early (the first in-window aura observation is the close), but never
    /// before the window has opened. Resolution freezes the market's trading.
    function submitResolution(ResolutionReceipt calldata receipt, bytes calldata signature) external;

    /// Void a window (no resolution) — refunds traders.
    function voidWindow(string calldata reason) external;
}
