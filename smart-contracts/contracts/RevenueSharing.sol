// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IRevenueSharing } from "./interfaces/IRevenueSharing.sol";
import { IHandleFactory } from "./interfaces/IHandleFactory.sol";
import { IFeeCollector } from "./interfaces/IFeeCollector.sol";
import { Handle } from "./Handle.sol";
import { Errors } from "./libraries/Errors.sol";
import { Constants } from "./libraries/Constants.sol";

/// @title RevenueSharing
/// @notice Pure fee splitter and router for the platform.
contract RevenueSharing is IRevenueSharing, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct SharingConfig {
        uint64 userShare; // bps
        uint64 lpShare; // bps
        uint64 protocolShare; // bps
        bool isSet; // true if custom override is applied
    }

    IERC20 public immutable usdc;
    IHandleFactory public immutable factory;

    address public protocol;
    IFeeCollector public feeCollector; // the protocol fee sink (may be 0 → protocol addr)

    /// Global fallback shares for any handle without a custom override
    SharingConfig public defaultShares;

    /// Custom per-handle fee shares (bps).
    mapping(bytes32 => SharingConfig) public customShares;

    /// Markets whitelisted to send fees.
    mapping(address => bool) public markets;

    event FeeSplit(bytes32 indexed handleId, uint256 amount, uint256 user, uint256 lp, uint256 protocol);
    event CustomSharesSet(bytes32 indexed handleId, uint64 user, uint64 lp, uint64 protocolShare);
    event DefaultSharesSet(uint64 user, uint64 lp, uint64 protocolShare);
    event MarketStatusUpdated(address indexed market, bool status);

    modifier onlyMarket() {
        if (!markets[msg.sender]) revert Errors.NotMarket();
        _;
    }

    constructor(IERC20 _usdc, IHandleFactory _factory) Ownable(msg.sender) {
        usdc = _usdc;
        factory = _factory;
        protocol = msg.sender;

        // Set safe initial global defaults (e.g., 40% User, 40% LP, 20% Protocol)
        _setDefaultShares(4000, 4000, 2000);
    }

    // --- Configuration ------------------------------------------------------

    function setMarket(address market, bool ok) external onlyOwner {
        markets[market] = ok;
        emit MarketStatusUpdated(market, ok);
    }

    function setProtocol(address _protocol) external onlyOwner {
        if (_protocol == address(0)) revert Errors.ZeroAddress();
        protocol = _protocol;
    }

    function setFeeCollector(IFeeCollector _feeCollector) external onlyOwner {
        feeCollector = _feeCollector;
    }

    /// @notice Set global default shares for all handles
    function setDefaultShares(uint64 user, uint64 lp, uint64 protocolShare) external onlyOwner {
        _setDefaultShares(user, lp, protocolShare);
    }

    function _setDefaultShares(uint64 user, uint64 lp, uint64 protocolShare) internal {
        if (uint256(user) + lp + protocolShare != Constants.BPS) revert Errors.BadSplit();

        defaultShares = SharingConfig({
            userShare: user,
            lpShare: lp,
            protocolShare: protocolShare,
            isSet: true
        });
        emit DefaultSharesSet(user, lp, protocolShare);
    }

    /// @notice Override shares for a specific handle
    function setCustomShares(
        bytes32 handleId,
        uint64 user,
        uint64 lp,
        uint64 protocolShare
    ) external onlyOwner {
        if (uint256(user) + lp + protocolShare != Constants.BPS) revert Errors.BadSplit();

        customShares[handleId] = SharingConfig({
            userShare: user,
            lpShare: lp,
            protocolShare: protocolShare,
            isSet: true
        });
        emit CustomSharesSet(handleId, user, lp, protocolShare);
    }

    // --- Fee Intake ---------------------------------------------------------

    /// @notice PULL method: Market approves USDC, router pulls it securely.
    function depositFees(bytes32 handleId, uint256 amount) external onlyMarket nonReentrant {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _split(handleId, amount);
    }

    /// @notice SWEEP method: Distributes ALL USDC currently sitting in this contract.
    /// Prevents cross-market hijacking by ignoring user-supplied amounts.
    function bankFees(bytes32 handleId) external onlyMarket nonReentrant {
        uint256 amount = usdc.balanceOf(address(this));
        if (amount == 0) revert Errors.ZeroAmount();
        _split(handleId, amount);
    }

    function _split(bytes32 handleId, uint256 amount) internal {
        Handle h = Handle(factory.handleOf(handleId));
        if (address(h) == address(0)) revert Errors.UnregisteredHandle();

        // Use custom shares if set, otherwise fallback to global defaults
        SharingConfig memory s = customShares[handleId].isSet ? customShares[handleId] : defaultShares;

        uint256 toUser = (amount * s.userShare) / Constants.BPS;
        uint256 toLp = (amount * s.lpShare) / Constants.BPS;
        uint256 toProtocol = amount - toUser - toLp;

        address pool = factory.poolOf(handleId);
        if (pool != address(0) && toLp > 0) {
            usdc.safeTransfer(pool, toLp);
        } else {
            toProtocol += toLp;
        }

        // user share → the Handle (the creator claims usdc.balanceOf(handle));
        // protocol share → the FeeCollector (protocol treasury withdraws).
        if (toUser > 0) usdc.safeTransfer(address(h), toUser);
        if (toProtocol > 0) {
            if (address(feeCollector) != address(0)) {
                // balanceOf reads the token balance live — no booking needed.
                usdc.safeTransfer(address(feeCollector), toProtocol);
            } else {
                usdc.safeTransfer(protocol, toProtocol);
            }
        }

        emit FeeSplit(handleId, amount, toUser, toLp, toProtocol);
    }
}