// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAddressesProvider
/// @notice Registry of every deployed Aura contract — the single source of
///         truth for protocol addresses. Consumers read through this instead of
///         hard-coding addresses; the owner updates on redeploys/upgrades.
interface IAddressesProvider {
    // --- views ----------------------------------------------------------------
    function usdc() external view returns (address);

    function auraToken() external view returns (address);

    function oracleFactory() external view returns (address);

    function handleFactory() external view returns (address);

    function marketMaker() external view returns (address);

    function orderBook() external view returns (address);

    function revenueSharing() external view returns (address);

    function pool() external view returns (address);

    function configurator() external view returns (address);

    // --- actions --------------------------------------------------------------
    function setUsdc(address) external;

    function setAuraToken(address) external;

    function setOracleFactory(address) external;

    function setHandleFactory(address) external;

    function setMarketMaker(address) external;

    function setOrderBook(address) external;

    function setRevenueSharing(address) external;

    function setPool(address) external;

    function setConfigurator(address) external;
}
