// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IAuraToken
/// @notice The Aura protocol token (AURA) — staked per handle to earn fees.
interface IAuraToken is IERC20 {
    function minter() external view returns (address);

    function mint(address to, uint256 amount) external;
}