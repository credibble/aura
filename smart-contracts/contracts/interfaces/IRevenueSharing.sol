// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IFeeCollector } from "./IFeeCollector.sol";

/// @title IRevenueSharing
/// @notice Pure fee splitter: routes a window's trading fee (USDC) to the
///         handle's Handle (creator + protocol shares) and the singleton Pool
///         (LP share). It holds no balances and does no claims — those live on
///         the Handle. Stakers earn AURA gifts via the handle's Stake receipt,
///         not USDC. Shares use a global default with per-handle overrides.
interface IRevenueSharing {
    // --- events ---------------------------------------------------------------
    event FeeSplit(bytes32 indexed handleId, uint256 amount, uint256 user, uint256 lp, uint256 protocol);

    event CustomSharesSet(bytes32 indexed handleId, uint64 user, uint64 lp, uint64 protocolShare);

    event DefaultSharesSet(uint64 user, uint64 lp, uint64 protocolShare);

    event MarketStatusUpdated(address indexed market, bool status);

    // --- views ----------------------------------------------------------------
    function markets(address market) external view returns (bool);

    function protocol() external view returns (address);

    // --- actions --------------------------------------------------------------
    /// Sweep + split ALL USDC currently held in this contract (no amount arg).
    function bankFees(bytes32 handleId) external;

    /// A whitelisted market deposits a window's trading fee for splitting.
    function depositFees(bytes32 handleId, uint256 amount) external;

    function setMarket(address market, bool ok) external;

    function setDefaultShares(uint64 user, uint64 lp, uint64 protocolShare) external;

    function setCustomShares(bytes32 handleId, uint64 user, uint64 lp, uint64 protocolShare) external;

    function setProtocol(address _protocol) external;

    function setFeeCollector(IFeeCollector _feeCollector) external;
}
