// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IConfigurator
/// @notice Protocol-level configuration values (fee curves, caps). Contract
///         parameters live here instead of as hard-coded constants, so the
///         protocol can tune them without redeploying. Read-only getters are
///         consumed by the contracts; the owner mutates them.
interface IConfigurator {
    /// Floor deposit fee (bps) — applied to any handle with aura > 0.
    function depositFeeMinBps() external view returns (uint64);

    /// Ceiling deposit fee (bps) — reached at `maxFeeAura`.
    function depositFeeMaxBps() external view returns (uint64);

    /// The max aura value (999999) — the top of the fee curve (the max fee
    function maxFeeAura() external view returns (uint256);

    /// Minimum window duration (epoch seconds) — windows shorter than this revert.
    function minWindowSeconds() external view returns (uint256);

    /// Close padding (seconds): buy/sell is rejected when the window is within
    /// this many seconds of ending (prevents last-second gaming of the close).
    function windowPadding() external view returns (uint256);

    /// Trading fee (bps) charged by the market on buys/sells.
    function marketFeeBps() external view returns (uint64);

    /// Grace period (seconds) a settled window waits before its leftover
    /// liquidity reserve can be released — claims need time to land first.
    function settlementGraceSeconds() external view returns (uint256);

    /// Stake deposit fee for a handle's aura: 0 at aura 0, clamped between the
    /// min (0.25%) and max (2.5%) config as aura scales linearly to maxFeeAura.
    function depositFeeBps(uint256 aura) external view returns (uint64);

    function setDepositFeeRange(uint64 minBps, uint64 maxBps) external;

    function setMaxFeeAura(uint256 maxFeeAura) external;

    function setMinWindowSeconds(uint256 _seconds) external;

    function setWindowPadding(uint256 _seconds) external;

    function setMarketFeeBps(uint64 bps) external;
}