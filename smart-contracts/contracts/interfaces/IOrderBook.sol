// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAuraOracle } from "../spec/IAuraOracle.sol";

/// @title IOrderBook
/// @notice Limit-order exchange for MarketMaker outcome shares. Buys
///         escrow USDC (size·price); sells escrow the window's shares (transferred
///         in from the maker). Matching is routed OFF-CHAIN — the taker submits
///         the specific order ids to fill; the contract enforces limitPrice and
///         minFill per fill. No on-chain order list.
interface IOrderBook {
    function marketOrder(
        IAuraOracle oracle,
        uint256 outcome,
        bool side,
        bytes32[] calldata orderIds,
        uint256 amount,
        uint256 limitPrice,
        uint256 minFill
    ) external returns (uint256);
    event OrderPlaced(
        bytes32 indexed handleId,
        address indexed oracle,
        uint256 outcome,
        bool side,
        address indexed maker,
        bytes32 id,
        uint256 price,
        uint256 size,
        uint256 expiresAt
    );
    event OrderCancelled(bytes32 indexed handleId, address indexed oracle, bytes32 id);
    event OrderUpdated(bytes32 indexed handleId, address indexed oracle, bytes32 id, uint256 price, uint256 size, uint256 expiresAt);
    event OrderFilled(bytes32 indexed handleId, address indexed oracle, bytes32 id, address indexed taker, uint256 outcome, uint256 shares, uint256 price);

    struct Order {
        address maker;
        address oracle; // window this order belongs to
        uint256 outcome; // the market outcome index (0 = YES)
        bool side; // true = buy, false = sell
        uint256 price; // 1e18 = 1 USDC per share
        uint256 size; // shares (whole order)
        uint256 filled;
        uint256 expiresAt; // epoch seconds; 0 = never
        bool cancelled;
    }

    function nextOrderId() external view returns (bytes32);

    function isActive(bytes32 id) external view returns (bool);

    function remainingOf(bytes32 id) external view returns (uint256);

    function orderOf(bytes32 id) external view returns (Order memory);

    function placeOrder(
        IAuraOracle oracle,
        uint256 outcome,
        bool side,
        uint256 price,
        uint256 size,
        uint256 expiresAt
    ) external returns (bytes32);

    function cancelOrder(IAuraOracle oracle, bytes32 id) external;

    function updateOrder(
        IAuraOracle oracle,
        bytes32 id,
        uint256 price,
        uint256 size,
        uint256 expiresAt
    ) external;
}
