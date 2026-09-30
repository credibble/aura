// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMarketRegistry} from "./interfaces/IMarketRegistry.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title MarketRegistry
/// @notice Registers Aura handles (markets) and wires the collateral. Each
///         (handle, window) gets its own oracle via the OracleFactory — there
///         is no single oracle adapter.
contract MarketRegistry is IMarketRegistry {
    address public immutable owner;
    IERC20 public immutable collateral;
    bytes32[] public handleIds;
    mapping(bytes32 => Market) public markets;

    event HandleRegistered(bytes32 indexed handleId, uint256 windowMinutes);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Errors.NotOwner();
        _;
    }

    constructor(IERC20 _collateral) {
        owner = msg.sender;
        collateral = _collateral;
    }

    function registerHandle(
        bytes32 handleId,
        uint256 windowMinutes
    ) external onlyOwner {
        if (markets[handleId].active) revert Errors.AlreadyRegistered();
        markets[handleId] = Market(handleId, windowMinutes, true);
        handleIds.push(handleId);
        emit HandleRegistered(handleId, windowMinutes);
    }

    function isRegistered(bytes32 handleId) external view returns (bool) {
        return markets[handleId].active;
    }

    function handleCount() external view returns (uint256) {
        return handleIds.length;
    }
}
