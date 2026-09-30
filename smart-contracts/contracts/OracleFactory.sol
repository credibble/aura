// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Oracle} from "./Oracle.sol";
import {Errors} from "./libraries/Errors.sol";
import {IOracleFactory} from "./interfaces/IOracleFactory.sol";

/// @title OracleFactory
/// @notice Deploys and tracks one Oracle per (handleId, windowStart) —
///         the Sui-style "every window is an oracle" model. All oracles share a
///         single trusted signer, but each holds independent state, so windows
///         resolve and settle fully independently.
contract OracleFactory is IOracleFactory {
    address public immutable signer;
    address public immutable registry;
    /// The protocol's deployer — may set `market` exactly once.
    address public immutable deployer;
    /// The MarketMaker allowed to confirm window bounds (set once, post-deploy,
    /// since the market is deployed after this factory).
    address public market;

    mapping(bytes32 => mapping(uint256 => Oracle)) public oracles;

    constructor(address _registry, address _signer) {
        registry = _registry;
        signer = _signer;
        deployer = msg.sender;
    }

    /// One-shot wiring of the trusted market. Until it is set no oracle can be
    /// deployed, so a window can never be opened without its market recorded.
    function setMarket(address _market) external {
        if (msg.sender != deployer) revert Errors.NotOwner();
        if (market != address(0)) revert Errors.AlreadyRegistered();
        if (_market == address(0)) revert Errors.ZeroAddress();
        market = _market;
        emit MarketSet(_market);
    }

    /// Deploy the oracle for a window (idempotent — returns the existing one).
    /// `metadata` describes the window on-chain (handle, bounds, outcomes). Only
    /// the trusted market (or the signer) may create one, so the metadata a user
    /// sees for a future window is always the protocol's.
    function deployOracle(
        bytes32 handleId,
        uint256 windowStart,
        string calldata metadata
    ) external returns (address) {
        if (msg.sender != market && msg.sender != signer) revert Errors.NotMarket();
        Oracle existing = oracles[handleId][windowStart];
        if (address(existing) != address(0)) return address(existing);
        Oracle wo = new Oracle(
            handleId,
            windowStart,
            signer,
            registry,
            market,
            metadata
        );
        oracles[handleId][windowStart] = wo;
        emit OracleDeployed(handleId, windowStart, address(wo));
        return address(wo);
    }

    function oracleOf(
        bytes32 handleId,
        uint256 windowStart
    ) external view returns (address) {
        return address(oracles[handleId][windowStart]);
    }
}
