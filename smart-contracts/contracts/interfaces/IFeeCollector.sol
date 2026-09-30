// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IFeeCollector
/// @notice The protocol's fee sink. RevenueSharing routes the protocol share of
///         every fee split here (per token); the protocol treasury withdraws.
interface IFeeCollector {
    // --- events ---------------------------------------------------------------
    event FeesDeposited(IERC20 indexed token, uint256 amount);

    event FeesWithdrawn(IERC20 indexed token, address indexed to, uint256 amount);

    // --- views ----------------------------------------------------------------
    /// Balances held per token.
    function balanceOf(IERC20 token) external view returns (uint256);

    // --- actions --------------------------------------------------------------
    /// Receive fees for a token (called by RevenueSharing).
    function depositFees(IERC20 token, uint256 amount) external;

    /// Withdraw fees for a token (protocol owner only).
    function withdraw(IERC20 token, uint256 amount) external;
}
