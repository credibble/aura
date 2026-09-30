// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMarketRegistry
/// @notice Registers Aura handles (markets) and wires the collateral.
interface IMarketRegistry {
    /// A registered handle (market) — binary or grouped, with a window length.
    struct Market {
        bytes32 handleId;
        uint256 windowMinutes;
        bool active;
        bool grouped;
    }

    function owner() external view returns (address);

    function registerHandle(bytes32 handleId, uint256 windowMinutes, bool grouped) external;

    function isRegistered(bytes32 handleId) external view returns (bool);

    function isGrouped(bytes32 handleId) external view returns (bool);

    function handleCount() external view returns (uint256);
}