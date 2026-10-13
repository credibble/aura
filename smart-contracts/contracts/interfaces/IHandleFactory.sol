// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IHandleFactory
/// @notice Registry of the per-handle top-level entities (Handle + Stake). The
///         global protocol addresses (market, oracle factory, revenue, auraLP
///         pool) come from the AddressesProvider — not per-address setters here.
interface IHandleFactory {
    // --- events ---------------------------------------------------------------
    event HandleCreated(
        bytes32 indexed handleId,
        address indexed handle,
        address indexed stake,
        address creator,
        address market,
        address oracleFactory,
        address revenue,
        string name,
        string symbol,
        string metadata,
        uint256 windowMinutes,
        uint256[] categories
    );

    // --- views ----------------------------------------------------------------
    function handleOf(bytes32 handleId) external view returns (address);

    function stakeOf(bytes32 handleId) external view returns (address);

    function poolOf(bytes32 handleId) external view returns (address);

    function handleCount() external view returns (uint256);

    function market() external view returns (address);

    function oracleFactory() external view returns (address);

    function revenue() external view returns (address);

    // --- actions --------------------------------------------------------------
    function createHandle(
        bytes32 handleId,
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadata,
        uint256 windowMinutes,
        uint256[] calldata categories
    ) external returns (address);

    function setAuraUpdater(bytes32 handleId, address updater) external;

    function setCurator(bytes32 handleId, address curator) external;

    function setGraduator(bytes32 handleId, address graduator) external;
}
