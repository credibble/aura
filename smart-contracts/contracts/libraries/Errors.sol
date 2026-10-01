// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Errors
/// @notice Shared custom errors — single source of truth for every revert
///         reason across the Aura protocol. Using custom errors keeps the code
///         gas-efficient, machine-decodable, and professional.
library Errors {
    // --- auth ----------------------------------------------------------
    error NotOwner();
    error NotFactory();
    error NotRevenue();
    error NotProtocol();
    error NotCurator();
    error NotUpdater();
    error NotGraduated();
    error NotOracle();
    error NotMarket();
    error NotMaker();
    error NotMinter();
    error NotPayer();
    error BadOracle();

    // --- registry / lifecycle ------------------------------------------
    error AlreadyRegistered();
    error UnregisteredHandle();
    error HandleExists();
    error BadIndex();
    error WindowAlreadyOpen();
    error WindowNotOpened();
    error WindowNotOpen();
    error WindowNotOpenOrFrozen();
    error AlreadyResolved();
    error NotSettled();
    error AlreadySettled();
    error BadOutcome();
    error BadWindow();
    /// A window whose strike is unusable (0 / no history) must never resolve.
    error BadStrike();

    // --- signature -----------------------------------------------------
    error BadSignatureLength();
    error InvalidSignature();

    // --- collateral ----------------------------------------------------
    error ZeroAmount();
    error ZeroAddress();
    error DustShares();
    error InsufficientShares();
    error NotApproved();
    error InsufficientBalance();
    error LedgerShort();
    error ReservedByMarkets();
    error InsufficientIdle();
    error NothingToRedeem();
    error NothingToRefund();
    error InsufficientLiquidity();

    // --- market maker --------------------------------------------------
    error BadPrice();
    error ZeroInput();
    error ZeroReturn();
    error MaxTokensExceeded();
    error NoOutcomeToken();
    error BadProbabilities();

    // --- settlement / safety -------------------------------------------
    /// Trading attempted after the window was settled.
    error WindowSettled();
    /// settle() was called before the window's Oracle resolved on-chain.
    error OracleNotResolved();
    /// An action happened before its time gate (resolution, settlement, finalize).
    error TooEarly();
    /// Aura pushed outside the protocol's allowed range.
    error BadAura();
    /// Too many source configs on a handle.
    error SourceLimit();
    /// More category codes on a handle than MAX_CATEGORIES allows.
    error TooManyCategories();
    /// Outcome receipts are position proofs — they cannot be moved as ERC20s.
    error ReceiptsNotTransferable();

    // --- order book ----------------------------------------------------
    error OrderNotActive();
    error OrderCancelled();
    error BelowMinFill();
    error BadSize();

    // --- revenue ----------------------------------------------------
    error BadSplit();
    error NotCreator();
    error InsufficientStake();
}