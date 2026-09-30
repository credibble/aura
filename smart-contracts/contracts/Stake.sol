// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IAuraToken } from "./interfaces/IAuraToken.sol";
import { Handle } from "./Handle.sol";
import { IConfigurator } from "./interfaces/IConfigurator.sol";
import { Constants } from "./libraries/Constants.sol";
import { Errors } from "./libraries/Errors.sol";
import { IStake } from "./interfaces/IStake.sol";

/// @title Stake
/// @notice Single-factor vault for AURA staked on a handle.
contract Stake is IStake, ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Virtual offset standard applied universally to prevent inflation attacks
    // while maintaining perfectly symmetrical deposit/withdraw math.
    uint256 private constant VIRTUAL_SHARES = 1e3;
    uint256 private constant VIRTUAL_ASSETS = 1;

    IERC20 public immutable aura;
    Handle public immutable handle;
    IConfigurator public immutable configurator; // protocol-level fee curve

    constructor(
        string memory name,
        string memory symbol,
        IERC20 _aura,
        Handle _handle,
        IConfigurator _configurator
    ) ERC20(name, symbol) {
        aura = _aura;
        handle = _handle;
        configurator = _configurator;
    }

    /// @notice Returns total AURA currently held in the vault.
    function totalAssets() public view returns (uint256) {
        return aura.balanceOf(address(this));
    }

    /// @notice Single-factor share price scaled by 1e18 (1.0 = 1e18).
    /// @dev Incorporates virtual offsets so UI matches deposit math exactly.
    function valuePerToken() public view returns (uint256) {
        return ((totalAssets() + VIRTUAL_ASSETS) * Constants.ONE) / (totalSupply() + VIRTUAL_SHARES);
    }

    /// @notice Deposit AURA into the vault.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();

        // Dynamic deposit fee: a multiplier of handle.aura() — 0 at no aura,
        // scaling to 2.5% at max aura (protocol-configured via the Configurator).
        uint64 feeBps = configurator.depositFeeBps(handle.aura());
        uint256 fee = (amount * feeBps) / Constants.BPS;
        uint256 net = amount - fee;

        uint256 currentAssets = totalAssets();
        uint256 currentSupply = totalSupply();

        // Universal virtual offset share calculation
        uint256 shares = (net * (currentSupply + VIRTUAL_SHARES)) / (currentAssets + VIRTUAL_ASSETS);
        if (shares == 0) revert Errors.DustShares();

        // Transfer full amount (fee remains in vault to naturally boost share value)
        aura.safeTransferFrom(msg.sender, address(this), amount);

        _mint(msg.sender, shares);
        emit Deposited(msg.sender, amount, shares);
        emit StakeStateChanged(totalSupply(), totalAssets(), valuePerToken());
    }

    /// @notice Burn receipts to withdraw pro-rata AURA from the vault.
    function withdraw(uint256 shares) external nonReentrant {
        if (shares == 0) revert Errors.ZeroAmount();

        uint256 currentSupply = totalSupply();
        uint256 currentAssets = totalAssets();

        // Symmetrical payout calculation mirroring the deposit offset
        uint256 payout = (shares * (currentAssets + VIRTUAL_ASSETS)) / (currentSupply + VIRTUAL_SHARES);
        if (payout == 0) revert Errors.ZeroAmount();

        _burn(msg.sender, shares);
        aura.safeTransfer(msg.sender, payout);

        emit Withdrawn(msg.sender, shares, payout);
        emit StakeStateChanged(totalSupply(), totalAssets(), valuePerToken());
    }

    /// @notice Reward stakers: AURA gifted to the vault increases share value
    ///         for all of them (e.g. the CRE stake-gifting workflow).
    /// @param memo Short on-chain reason (e.g. "CRE reward for @handle aura").
    function reward(uint256 amount, string calldata memo) external nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();
        aura.safeTransferFrom(msg.sender, address(this), amount);
        emit Rewarded(amount, memo);
        emit StakeStateChanged(totalSupply(), totalAssets(), valuePerToken());
    }

    /// @notice Value of `user`'s receipts in AURA at current share price.
    function earned(address user) external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;

        // Matches the valuePerToken and withdraw math symmetrically
        return (balanceOf(user) * (totalAssets() + VIRTUAL_ASSETS)) / (supply + VIRTUAL_SHARES);
    }
}