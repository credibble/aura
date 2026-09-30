// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAuraOracle} from "../spec/IAuraOracle.sol";

/// @title IMarketMaker
/// @notice The binary LMSR prediction market (YES/NO windows on the aura index).
interface IMarketMaker {
    function openWindow(
        bytes32 handleId,
        uint256 windowStart,
        uint256 windowEnd,
        string[] calldata outcomes,
        string[] calldata metadata,
        uint256[] calldata probabilities,
        string calldata oracleMetadata,
        uint256 funding
    ) external;

    function settle(IAuraOracle oracle, uint256 winningOutcome) external;

    function buy(IAuraOracle oracle, uint256 outcome, uint256 amountIn, uint256 minShares) external;

    function sell(IAuraOracle oracle, uint256 outcome, uint256 delta, uint256 minProceeds) external;

    function claim(IAuraOracle oracle, uint256 outcome) external;

    function priceOf(IAuraOracle oracle, uint256 outcome) external view returns (uint256);

    function isOpen(IAuraOracle oracle) external view returns (bool);

    function approve(IAuraOracle oracle, uint256 outcome, uint256 amount) external;

    function transfer(address to, IAuraOracle oracle, uint256 outcome, uint256 q) external;

    function transferFrom(address from, address to, IAuraOracle oracle, uint256 outcome, uint256 q) external;
}