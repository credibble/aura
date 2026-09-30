// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMarketRegistry
/// @notice Registers Aura handles (markets) and wires the collateral.
interface IMarketRegistry {
    function handleCount() external view returns (uint256);
    event HandleRegistered(bytes32 indexed handleId, uint256 windowMinutes);

    /// A registered handle (market) with a window length.
    struct Market {
        bytes32 handleId;
        uint256 windowMinutes;
        bool active;
    }

    function owner() external view returns (address);

    function registerHandle(bytes32 handleId, uint256 windowMinutes) external;

    function isRegistered(bytes32 handleId) external view returns (bool);
}
