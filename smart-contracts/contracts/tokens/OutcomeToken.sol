// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Errors } from "../libraries/Errors.sol";

/// @title OutcomeToken
/// @notice Transferable ERC20 receipt for a single (window, outcome) position in
///         the MarketMaker. Minted to buyers on `buy`, burned on `sell`/`claim`,
///         and movable between parties (order book). The `metadata` string
///         describes the position on-chain (JSON: handle, oracle, outcome,
///         strike, window bounds).
contract OutcomeToken is ERC20 {
    /// Position metadata (JSON string), set at deployment — e.g.
    /// `{"handle":"btc","oracle":"0x…","outcome":0,"strike":"5000",
    ///   "windowStart":"…","windowEnd":"…"}`.
    string public metadata;

    /// The window oracle this token belongs to.
    address public immutable oracle;
    /// The outcome index within that window (0 = YES).
    uint256 public immutable outcome;
    /// The MarketMaker — the only account allowed to mint / burn.
    address public immutable minter;

    modifier onlyMinter() {
        if (msg.sender != minter) revert Errors.NotMinter();
        _;
    }

    constructor(
        string memory name,
        string memory symbol,
        string memory _metadata,
        address _oracle,
        uint256 _outcome
    ) ERC20(name, symbol) {
        metadata = _metadata;
        oracle = _oracle;
        outcome = _outcome;
        minter = msg.sender;
    }

    /// Mint winning/held shares to a holder (market only).
    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    /// A holder burns their own shares (market only, e.g. on sell/claim).
    function burn(address from, uint256 amount) external onlyMinter {
        _burn(from, amount);
    }

    // --- non-transferable ----------------------------------------------------
    // The receipt is a POSITION PROOF: the claim lives in the MarketMaker's
    // `shares` ledger, so letting these move as plain ERC20s would create
    // receipts that look like a position and pay nothing. Positions move through
    // the market itself (`MarketMaker.transfer` / order-book escrow), which moves
    // both ledgers together.

    function transfer(address, uint256) public pure override returns (bool) {
        revert Errors.ReceiptsNotTransferable();
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert Errors.ReceiptsNotTransferable();
    }

    function approve(address, uint256) public pure override returns (bool) {
        revert Errors.ReceiptsNotTransferable();
    }
}