// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IOracleFactory
/// @notice Deploys and tracks one Oracle per (handle, window).
interface IOracleFactory {
    /// The single trusted signer all window oracles share.
    function signer() external view returns (address);

    function registry() external view returns (address);

    /// Deploy the oracle for a window (idempotent — returns the existing one).
    function deployOracle(bytes32 handleId, uint256 windowStart, string calldata metadata) external returns (address);

    function oracleOf(bytes32 handleId, uint256 windowStart) external view returns (address);
}