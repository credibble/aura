// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAuraToken} from "./interfaces/IAuraToken.sol";

import {Handle} from "./Handle.sol";
import {Stake} from "./Stake.sol";
import {Pool} from "./Pool.sol";
import {Errors} from "./libraries/Errors.sol";
import {Constants} from "./libraries/Constants.sol";
import {IConfigurator} from "./interfaces/IConfigurator.sol";
import {IAddressesProvider} from "./interfaces/IAddressesProvider.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import { IHandleFactory } from "./interfaces/IHandleFactory.sol";

/// @title HandleFactory
/// @notice Deploys and tracks each Handle (the top-level entity bundling
///         identity, creator, markets, protocol wiring and its per-handle
///         Stake receipt) — idempotent per handleId. The Pool is NOT deployed
///         here: it is a SINGLETON auraLP vault (a separate top-level contract)
///         shared by every handle, so the factory only holds its address. The
///         protocol deployer wires the global OracleFactory, RevenueSharing,
///         Pool and MarketMaker after deployment; the factory pushes them onto
///         every (existing and future) Handle so each Handle is self-contained
///         on-chain.
contract HandleFactory is IHandleFactory {
    IAuraToken public immutable aura;
    IERC20 public immutable usdc;
    IConfigurator public immutable configurator;
    IAddressesProvider public immutable addresses; // single source of protocol addresses
    address public owner;

    mapping(bytes32 => Handle) public handles;
    Handle[] public handleList;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Errors.NotOwner();
        _;
    }

    constructor(
        IAuraToken _aura,
        IERC20 _usdc,
        IConfigurator _configurator,
        IAddressesProvider _addresses
    ) {
        aura = _aura;
        usdc = _usdc;
        configurator = _configurator;
        addresses = _addresses;
        owner = msg.sender;
    }

    // --- handle deployment --------------------------------------------------

    /// Deploy (or revert on) a handle and its per-handle Stake receipt. The
    /// global protocol addresses (market, oracle factory, revenue, auraLP pool)
    /// come from the AddressesProvider — no per-address setters here.
    function createHandle(
        bytes32 handleId,
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadata,
        uint256 windowMinutes,
        uint256[] calldata categories
    ) external onlyOwner returns (address) {
        if (address(handles[handleId]) != address(0)) revert Errors.HandleExists();
        if (creator == address(0)) revert Errors.ZeroAddress();
        Handle h = new Handle(
            handleId,
            creator,
            name,
            symbol,
            metadata,
            windowMinutes,
            categories,
            address(this),
            IERC20(address(usdc))
        );
        Stake stake = new Stake(
            string.concat("Aura ", handleLabel(handleId), " Stake"),
            string.concat("A-", handleLabel(handleId), "-S"),
            IERC20(address(aura)),
            h,
            configurator
        );
        h.setStake(address(stake));
        h.setMarketByFactory(addresses.marketMaker());
        h.setOracleFactory(addresses.oracleFactory());
        h.setRevenue(addresses.revenueSharing());
        handles[handleId] = h;
        handleList.push(h);
        emit HandleCreated(
            handleId,
            address(h),
            address(stake),
            creator,
            addresses.marketMaker(),
            addresses.oracleFactory(),
            addresses.revenueSharing(),
            name,
            symbol,
            metadata,
            windowMinutes,
            categories
        );
        return address(h);
    }

    // --- registry -----------------------------------------------------------

    /// Bootstrap/rotate a handle's aura updater. Handle curation is
    /// `onlyCurator` (factory OR the handle's curator, which falls back to the
    /// aura updater until one is set), so the factory owner routes this one
    /// through the contract — everything after bootstrap is driven by the oracle
    /// relayer key.
    function setAuraUpdater(
        bytes32 handleId,
        address updater
    ) external onlyOwner {
        Handle h = handles[handleId];
        if (address(h) == address(0)) revert Errors.UnregisteredHandle();
        if (updater == address(0)) revert Errors.ZeroAddress();
        h.setAuraUpdater(updater);
    }

    /// Split curation away from the aura updater: a dedicated key (or multisig)
    /// owns metadata/sources/category/verification/graduation, while the relayer
    /// only pushes aura. Pass the zero address to hand curation back to the
    /// updater.
    function setCurator(bytes32 handleId, address curator) external onlyOwner {
        Handle h = handles[handleId];
        if (address(h) == address(0)) revert Errors.UnregisteredHandle();
        h.setCurator(curator);
    }

    /// Wire the dedicated graduation role (the CRE graduation consumer), so an
    /// off-chain workflow can graduate handles without holding curation rights.
    /// Pass the zero address to clear it (the curator then graduates).
    function setGraduator(
        bytes32 handleId,
        address graduator
    ) external onlyOwner {
        Handle h = handles[handleId];
        if (address(h) == address(0)) revert Errors.UnregisteredHandle();
        h.setGraduator(graduator);
    }

    function handleOf(bytes32 handleId) external view returns (address) {
        return address(handles[handleId]);
    }

    function stakeOf(bytes32 handleId) external view returns (address) {
        return address(handles[handleId].stake());
    }

    /// The singleton auraLP vault (the same Pool for every handle).
    function poolOf(bytes32) external view returns (address) {
        return addresses.pool();
    }

    function oracleFactory() external view returns (address) {
        return addresses.oracleFactory();
    }

    function revenue() external view returns (address) {
        return addresses.revenueSharing();
    }

    function market() external view returns (address) {
        return addresses.marketMaker();
    }

    function handleCount() external view returns (uint256) {
        return handleList.length;
    }

    /// First 4 bytes of the handle as "0x…" (readable receipt prefix).
    function handleLabel(
        bytes32 handleId
    ) internal pure returns (string memory) {
        return Strings.toHexString(uint256(handleId) >> 192, 8);
    }
}