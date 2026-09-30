// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * IStake — the public surface of Stake.
 *
 * Declared once, where callers read it: the events the contract announces
 * first, then the external functions it accepts. Access control lives in the
 * implementation — an interface carries no modifiers — so the declarations
 * here are the ungated shape of each function, admin and protocol alike.
 */
interface IStake {
    // --- events ---------------------------------------------------------------
    event Deposited(address indexed user, uint256 auraAmount, uint256 sharesMinted);

    event Withdrawn(address indexed user, uint256 sharesBurned, uint256 auraPayout);

    event Rewarded(uint256 auraAmount, string memo);

    /// The receipt's state after any movement — the indexer's staking chart source.
    event StakeStateChanged(uint256 totalSupply, uint256 totalAssets, uint256 valuePerToken);

    // --- views ----------------------------------------------------------------
    function totalAssets() external view returns (uint256);

    function valuePerToken() external view returns (uint256);

    function earned(address user) external view returns (uint256);

    // --- actions --------------------------------------------------------------
    function deposit(uint256 amount) external;

    function withdraw(uint256 shares) external;

    function reward(uint256 amount, string calldata memo) external;
}
