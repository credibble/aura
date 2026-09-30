// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * IPool — the public surface of Pool.
 *
 * Declared once, where callers read it: the events the contract announces
 * first, then the external functions it accepts. Access control lives in the
 * implementation — an interface carries no modifiers — so the declarations
 * here are the ungated shape of each function, admin and protocol alike.
 */
interface IPool {
    // --- events ---------------------------------------------------------------
    event Deposited(address indexed user, uint256 usdc, uint256 receipts);

    event Withdrawn(address indexed user, uint256 receipts, uint256 payout);

    event Reserved(address indexed oracle, uint256 amount);

    event PaidOut(address indexed oracle, address indexed to, uint256 amount);

    event Unreserved(address indexed oracle, uint256 amount);

    /// The vault's state after any movement — the indexer's pool chart source.
    event PoolStateChanged(uint256 totalAssets, uint256 totalSupply, uint256 idle, uint256 totalReserved);

    // --- views ----------------------------------------------------------------
    function decimals() external view returns (uint8);

    function totalAssets() external view returns (uint256);

    function valuePerToken() external view returns (uint256);

    function idle() external view returns (uint256);

    function earned(address user) external view returns (uint256);

    // --- actions --------------------------------------------------------------
    function deposit(uint256 amount) external;

    function withdraw(uint256 shares) external;

    function reserve(address oracle, uint256 amount) external;

    function payout(address oracle, address to, uint256 amount) external;

    function unreserve(address oracle, uint256 amount) external;
}
