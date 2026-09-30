// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IFeeCollector } from "./interfaces/IFeeCollector.sol";
import { Errors } from "./libraries/Errors.sol";

/// @title FeeCollector
/// @notice The protocol treasury's fee sink — the protocol share of every fee
///         split lands here per token (routed by RevenueSharing). The owner
///         (protocol treasury) withdraws accrued fees. Chain-agnostic (any
///         ERC20); balances are read live from the token — no tracker.
contract FeeCollector is IFeeCollector, Ownable2Step {
    using SafeERC20 for IERC20;

    event FeesDeposited(IERC20 indexed token, uint256 amount);
    event FeesWithdrawn(IERC20 indexed token, address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// Receive fees (called by RevenueSharing — anyone may donate fees too).
    function depositFees(IERC20 token, uint256 amount) external {
        if (amount == 0) revert Errors.ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit FeesDeposited(token, amount);
    }

    /// The protocol treasury withdraws accrued fees.
    function withdraw(IERC20 token, uint256 amount) external onlyOwner {
        if (amount > token.balanceOf(address(this))) revert Errors.LedgerShort();
        token.safeTransfer(msg.sender, amount);
        emit FeesWithdrawn(token, msg.sender, amount);
    }

    /// Fees held for a token (live balance — no tracker).
    function balanceOf(IERC20 token) external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}