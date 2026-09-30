// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Aura Oracle interface
/// @notice The single trusted resolution authority for ONE (handleId,
///         windowStart) market window. Every window has its own oracle contract
///         (Sui per-window oracle style) carrying its own handleId/windowStart.
///         Mirrors the shared spec in `packages/contracts/src/receipt.ts`
///         (EIP-712 typed data).
interface IAuraOracle {
    /// The on-chain lifecycle of a (handleId, windowStart) market window.
    enum WindowStatus {
        OPEN, // trading allowed
        FROZEN, // trading locked; awaiting resolution
        RESOLVED, // settled from a signed receipt
        VOIDED // no resolution — market voided and refunded
    }

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

    event WindowOpened(bytes32 indexed handleId, uint256 windowStart, uint256 windowEnd);
    event WindowFrozen(bytes32 indexed handleId, uint256 windowStart);
    event WindowResolved(bytes32 indexed handleId, uint256 windowStart, bool direction, uint256 indexClose, bytes32 resolutionHash);
    event WindowVoided(bytes32 indexed handleId, uint256 windowStart, string reason);

    /// Verify the oracle signature and settle the window once.
    function submitResolution(ResolutionReceipt calldata receipt, bytes calldata signature) external;

    /// Confirm the window's real end + canonical metadata (the MarketMaker relays
    /// it at open). One-shot; also overwrites squatter-set metadata.
    function confirmWindow(uint256 windowEnd, string calldata metadata) external;

    /// The window's confirmed end (0 = never confirmed).
    function windowEnd() external view returns (uint256);

    /// Void a window (no resolution) — refunds traders.
    function voidWindow(string calldata reason) external;

    /// The handle and window this oracle is bound to (immutable identity).
    function handleId() external view returns (bytes32);

    function windowStart() external view returns (uint256);

    /// The oracle IS the window — no (handleId, windowStart) params needed.
    function windowStatus() external view returns (WindowStatus);

    function resolutionOf()
        external
        view
        returns (bool direction, uint256 indexClose, bytes32 resolutionHash, uint256 resolvedAt);
}