// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockStake
/// @notice Test double for `Stake.reward`'s AURA pull. Mirrors the real
///         `safeTransferFrom(msg.sender, address(this), amount)` semantics so
///         the RewardConsumer's approve+reward flow is exercised for real.
contract MockStake {
    using SafeERC20 for IERC20;

    IERC20 public immutable aura;
    uint256 public totalRewarded;

    constructor(IERC20 _aura) {
        aura = _aura;
    }

    function reward(uint256 amount, string calldata) external {
        aura.safeTransferFrom(msg.sender, address(this), amount);
        totalRewarded += amount;
    }
}
