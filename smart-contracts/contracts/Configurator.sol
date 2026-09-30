// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IConfigurator } from "./interfaces/IConfigurator.sol";
import { Errors } from "./libraries/Errors.sol";
import { Constants } from "./libraries/Constants.sol";

/// @title Configurator
/// @notice Protocol-level configuration — the single place fee curves and caps
///         live. The Stake deposit fee is dynamic: a multiplier of the handle's
///         aura, scaled between a 0.25% protocol floor and a 2.5% ceiling as the
///         aura moves 0 → 999999 (no aura = 0 fee, max aura = 2.5%).
contract Configurator is IConfigurator, Ownable2Step {
    uint64 public depositFeeMinBps; // 25 = 0.25%
    uint64 public depositFeeMaxBps; // 250 = 2.5%
    uint256 public maxFeeAura; // 999_999 — aura at which the max fee kicks in
    uint64 public marketFeeBps; // trading fee on the MarketMaker
    uint256 public minWindowSeconds; // minimum window duration
    uint256 public windowPadding; // reject buy/sell within this close window
    /// How long after a window's end before its leftover liquidity reserve may
    /// be released (`MarketMaker.finalize`). Claims must have time to land first.
    uint256 public settlementGraceSeconds;

    event DepositFeeRangeSet(uint64 minBps, uint64 maxBps);
    event MaxFeeAuraSet(uint256 maxFeeAura);
    event MarketFeeBpsSet(uint64 bps);
    event MinWindowSecondsSet(uint256 minWindowSeconds);
    event WindowPaddingSet(uint256 windowPadding);
    event SettlementGraceSet(uint256 seconds_);

    constructor() Ownable(msg.sender) {
        depositFeeMinBps = 25;
        depositFeeMaxBps = 250;
        maxFeeAura = 999_999;
        marketFeeBps = 0;
        minWindowSeconds = 10;
        windowPadding = 5;
        settlementGraceSeconds = 3 days;
    }

    function setDepositFeeRange(uint64 minBps, uint64 maxBps) external onlyOwner {
        if (minBps > maxBps || maxBps > Constants.BPS) revert Errors.BadSplit();
        depositFeeMinBps = minBps;
        depositFeeMaxBps = maxBps;
        emit DepositFeeRangeSet(minBps, maxBps);
    }

    function setMaxFeeAura(uint256 _maxFeeAura) external onlyOwner {
        if (_maxFeeAura == 0) revert Errors.ZeroAmount();
        maxFeeAura = _maxFeeAura;
        emit MaxFeeAuraSet(_maxFeeAura);
    }

    function setMinWindowSeconds(uint256 _seconds) external onlyOwner {
        if (_seconds == 0) revert Errors.ZeroAmount();
        minWindowSeconds = _seconds;
        emit MinWindowSecondsSet(_seconds);
    }

    function setWindowPadding(uint256 _seconds) external onlyOwner {
        windowPadding = _seconds;
        emit WindowPaddingSet(_seconds);
    }

    function setMarketFeeBps(uint64 bps) external onlyOwner {
        if (bps > Constants.BPS) revert Errors.BadSplit();
        marketFeeBps = bps;
        emit MarketFeeBpsSet(bps);
    }

    /// Grace period (seconds) before a settled window's reserve may be released.
    function setSettlementGraceSeconds(uint256 seconds_) external onlyOwner {
        settlementGraceSeconds = seconds_;
        emit SettlementGraceSet(seconds_);
    }

    /// Stake deposit fee for a handle's aura: 0 at aura 0; then the linear scale
    /// aura/maxFeeAura × maxBps (floored at minBps, 0.25%); clamped at the max
    /// fee once aura reaches maxFeeAura.
    function depositFeeBps(uint256 aura) public view returns (uint64) {
        if (aura == 0) return 0;
        if (aura >= maxFeeAura) return depositFeeMaxBps;
        uint256 scaled = (aura * depositFeeMaxBps) / maxFeeAura;
        if (scaled < depositFeeMinBps) return depositFeeMinBps;
        return scaled > type(uint64).max ? type(uint64).max : uint64(scaled);
    }
}