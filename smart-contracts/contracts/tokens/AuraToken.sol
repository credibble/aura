// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Errors } from "../libraries/Errors.sol";

/// @title AuraToken
/// @notice The Aura protocol token — staked per handle to earn the handle's
///         trading-fee stream and to govern its sources. Plain ERC20 with a
///         single minting authority (the protocol treasury).
contract AuraToken is ERC20 {
    address public immutable minter;

    constructor() ERC20("Aura", "AURA") {
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert Errors.NotMinter();
        _mint(to, amount);
    }
}