// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IERC20Metadata
} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    Ownable2Step,
    Ownable
} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IAddressesProvider} from "./interfaces/IAddressesProvider.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Constants} from "./libraries/Constants.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title Pool
/// @notice Singleton auraLP vault providing liquidity across all market windows.
contract Pool is ERC20, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Virtual offset standard applied universally to prevent inflation attacks
    // while maintaining perfectly symmetrical deposit/withdraw math.
    uint256 private constant VIRTUAL_SHARES = 1e3;
    uint256 private constant VIRTUAL_ASSETS = 1;

    IERC20 public immutable usdc;
    IAddressesProvider public immutable addresses;
    uint8 private immutable _usdcDecimals;

    /// Markets whitelisted to reserve / pay / release window capacity.
    mapping(address => bool) public markets;

    /// USDC reserved per window — keyed by the window's ORACLE address (unique
    /// per (handleId, windowStart), so it is the canonical window identity).
    mapping(address => uint256) public reserved;
    uint256 public totalReserved;

    event Deposited(address indexed user, uint256 usdc, uint256 receipts);
    event Withdrawn(address indexed user, uint256 receipts, uint256 payout);
    event Reserved(address indexed oracle, uint256 amount);
    event PaidOut(address indexed oracle, address indexed to, uint256 amount);
    event Unreserved(address indexed oracle, uint256 amount);

    /// A market may back windows only if the AddressesProvider knows it.
    modifier onlyMarket() {
        if (
            msg.sender != addresses.marketMaker() &&
            msg.sender != addresses.orderBook()
        ) revert Errors.NotMarket();
        _;
    }

    constructor(
        string memory name,
        string memory symbol,
        IERC20 _usdc,
        IAddressesProvider _addresses
    ) ERC20(name, symbol) Ownable(msg.sender) {
        if (address(_usdc) == address(0)) revert Errors.ZeroAddress();
        if (address(_addresses) == address(0)) revert Errors.ZeroAddress();
        usdc = _usdc;
        addresses = _addresses;

        // Match token decimals with underlying USDC
        try IERC20Metadata(address(_usdc)).decimals() returns (uint8 d) {
            _usdcDecimals = d;
        } catch {
            _usdcDecimals = 6;
        }
    }

    function decimals() public view override returns (uint8) {
        return _usdcDecimals;
    }

    /// Total USDC held directly by the contract.
    function totalAssets() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// Value of one LP receipt scaled by 1e18.
    /// @dev Incorporates virtual offsets so UI matches deposit math exactly.
    function valuePerToken() public view returns (uint256) {
        return ((totalAssets() + VIRTUAL_ASSETS) * Constants.ONE) /
            (totalSupply() + VIRTUAL_SHARES);
    }

    /// Unencumbered USDC — available for new window reserves and LP withdrawals.
    function idle() public view returns (uint256) {
        uint256 bal = totalAssets();
        return bal > totalReserved ? bal - totalReserved : 0;
    }

    // --- LP provisioning ----------------------------------------------------

    /// Deposit USDC liquidity → mint Pool receipts pro-rata to pool value.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();

        uint256 currentAssets = totalAssets();
        uint256 currentSupply = totalSupply();

        // Inflation-resistant share calculation using virtual offsets
        uint256 shares = (amount * (currentSupply + VIRTUAL_SHARES)) /
            (currentAssets + VIRTUAL_ASSETS);
        if (shares == 0) revert Errors.DustShares();

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, shares);

        emit Deposited(msg.sender, amount, shares);
    }

    /// Burn Pool receipts → pro-rata USDC value up to idle().
    function withdraw(uint256 shares) external nonReentrant {
        if (shares == 0) revert Errors.ZeroAmount();

        uint256 currentSupply = totalSupply();
        uint256 currentAssets = totalAssets();

        // Symmetrical payout calculation mirroring the deposit offset
        uint256 payoutUsdc = (shares * (currentAssets + VIRTUAL_ASSETS)) /
            (currentSupply + VIRTUAL_SHARES);
        if (payoutUsdc > idle()) revert Errors.ReservedByMarkets();

        _burn(msg.sender, shares);
        usdc.safeTransfer(msg.sender, payoutUsdc);

        emit Withdrawn(msg.sender, shares, payoutUsdc);
    }

    /// Full value of `user`'s receipts in USDC.
    function earned(address user) external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;

        // Matches the valuePerToken and withdraw math symmetrically
        return (balanceOf(user) * (totalAssets() + VIRTUAL_ASSETS)) /
            (supply + VIRTUAL_SHARES);
    }

    // --- Window Backing (called by whitelisted markets) ----------------------

    /// Reserve payout capacity for a window from idle USDC.
    function reserve(
        address oracle,
        uint256 amount
    ) external onlyMarket nonReentrant {
        if (amount > idle()) revert Errors.InsufficientIdle();

        reserved[oracle] += amount;
        totalReserved += amount;

        emit Reserved(oracle, amount);
    }

    /// Pay a winner from a window's reserved capacity.
    function payout(
        address oracle,
        address to,
        uint256 amount
    ) external onlyMarket nonReentrant {
        uint256 claim = reserved[oracle];
        if (amount > claim) revert Errors.LedgerShort();

        reserved[oracle] = claim - amount;
        totalReserved -= amount;

        usdc.safeTransfer(to, amount);
        emit PaidOut(oracle, to, amount);
    }

    /// Release unused reserved capacity back to idle.
    function unreserve(
        address oracle,
        uint256 amount
    ) external onlyMarket nonReentrant {
        uint256 claim = reserved[oracle];
        if (amount > claim) revert Errors.LedgerShort();

        reserved[oracle] = claim - amount;
        totalReserved -= amount;

        emit Unreserved(oracle, amount);
    }
}
