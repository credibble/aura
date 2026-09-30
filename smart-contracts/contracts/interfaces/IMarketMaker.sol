// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAuraOracle} from "../spec/IAuraOracle.sol";
import { OutcomeToken } from "../tokens/OutcomeToken.sol";

/// @title IMarketMaker
/// @notice The binary LMSR prediction market (YES/NO windows on the aura index).
interface IMarketMaker {
    event WindowOpened(
        bytes32 indexed handleId,
        address indexed oracle,
        uint256 windowStart,
        uint256 windowEnd,
        string[] outcomes,
        uint256[] probabilities,
        uint256 funding,
        string oracleMetadata
    );

    /// The window's live price vector (1e18 per outcome), emitted after every
    /// state change — open, buy, sell — so the indexer's price chart reads the
    /// exact numbers traders pay instead of re-deriving the LMSR off-chain.
    event PricesUpdated(bytes32 indexed handleId, address indexed oracle, uint256[] prices);
    event Bought(
        bytes32 indexed handleId,
        address indexed oracle,
        address indexed trader,
        uint256 outcome,
        uint256 amountIn,
        uint256 sharesMinted,
        uint256 price
    );
    event Sold(
        bytes32 indexed handleId,
        address indexed oracle,
        address indexed trader,
        uint256 outcome,
        uint256 sharesBurned,
        uint256 proceeds
    );
    event Settled(
        bytes32 indexed handleId,
        address indexed oracle,
        uint256 winningOutcome
    );
    event Claimed(
        bytes32 indexed handleId,
        address indexed oracle,
        address indexed trader,
        uint256 outcome,
        uint256 sharesBurned,
        uint256 payout
    );
    event Approved(
        address indexed owner,
        address indexed oracle,
        uint256 outcome,
        uint256 amount
    );
    event OutcomeTokenDeployed(address indexed oracle, uint256 outcome, address token);
    event VoidRedeemed(
        bytes32 indexed handleId,
        address indexed oracle,
        address indexed trader,
        uint256 payout
    );
    event Transferred(
        address indexed from,
        address indexed to,
        address indexed oracle,
        uint256 outcome,
        uint256 amount
    );

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

    function finalize(IAuraOracle oracle) external;

    function redeemVoid(IAuraOracle oracle) external;

    function outcomeTokenOf(IAuraOracle oracle, uint256 outcome) external view returns (OutcomeToken);

    function buyCost(IAuraOracle oracle, uint256 outcome, uint256 delta) external view returns (uint256);

    function sellProceeds(IAuraOracle oracle, uint256 outcome, uint256 delta) external view returns (uint256);

    function transferFrom(address from, address to, IAuraOracle oracle, uint256 outcome, uint256 q) external;
}
