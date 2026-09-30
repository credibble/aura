// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    Ownable2Step,
    Ownable
} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IRevenueSharing} from "./interfaces/IRevenueSharing.sol";
import {Errors} from "./libraries/Errors.sol";
import {Constants} from "./libraries/Constants.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IHandle } from "./interfaces/IHandle.sol";

/// @title Handle
/// @notice The top-level on-chain entity for a handle (e.g. "btc", "elon", a
///         creator's handle). Bundles EVERYTHING that belongs to one handle so
///         a client can drive the full on-chain lifecycle from the Handle alone:
///           identity  — handleId, name, symbol, metadata, createdAt
///           ownership — the creator (owner; required for every handle)
///           markets   — the IndexMarket + whitelist of markets allowed to call
///                       the handle's Pool
///           protocol  — the OracleFactory (resolves the handle's windows) and
///                       RevenueSharing (fee split + creator/protocol claims)
///           LP        — the per-handle Stake (AURA staking) and Pool (USDC
///                       prediction liquidity / auraLP vault) receipts
///           curation  — windowMinutes and the allowed oracle source ids that
///                       feed the handle's aura index
///         The HandleFactory deploys one Handle per handleId and wires the
///         per-handle tokens; the protocol (factory / oracle relayer) curates
///         metadata, sources and the market whitelist — the owner's only
///         exclusive right is claiming the handle's USDC revenue.
contract Handle is IHandle, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    /// Protocol aura ceiling (1e2 scale: 100.00) — mirrors the oracle's clamp.
    uint256 public constant MAX_AURA = 10_000;
    /// Hard cap on source configs (keeps `sources` enumerable and cheap to index).
    uint256 public constant MAX_SOURCES = 32;
    /// Hard cap on category codes — a handle carries a few at most.
    uint256 public constant MAX_CATEGORIES = 4;
    // --- identity -----------------------------------------------------------
    bytes32 public immutable handleId;
    string public name;
    string public symbol;
    string public metadata; // profile metadata (JSON / IPFS URI)
    uint256 public immutable createdAt; // block.timestamp at deployment

    // --- protocol wiring ----------------------------------------------------
    address public immutable factory; // the HandleFactory that deployed this
    address public market; // the MarketMaker pricing this handle's aura
    address public oracleFactory; // resolves this handle's per-window Oracles
    address public revenue; // the reward distributor for this handle's fees

    // --- LP receipts (per-handle, wired by the factory) ----------------------
    address public stake; // the handle's Stake receipt (AURA LP)

    // --- curation -----------------------------------------------------------
    uint256 public windowMinutes;
    /// Source configs feeding this handle's aura index — each entry is a JSON
    /// object string the oracle's adapters parse, e.g.
    /// `{"platform":"spotify","username":"devar"}` or
    /// `{"platform":"news","outlet":"bbc","feed":"...rss"}`. Every platform
    /// adapter (BaseSource) reads only the fields it owns and extracts its own
    /// data into a time series.
    string[] public sources;

    // --- aura ----------------------------------------------------------------
    /// The handle's current Aura score (1e2: 50.00 → 5000), pushed by the
    /// protocol updater. Feeds the Stake receipt's share price — stakers who
    /// entered at a low aura profit as the aura rises and gifts accrue.
    uint256 public aura;
    /// Protocol address allowed to call updateAura (the oracle relayer).
    address public auraUpdater;
    /// Dedicated curation role (metadata, sources, category, verification,
    /// graduation, window length, updater rotation). Zero = fall back to
    /// `auraUpdater`, which is the pre-split behaviour.
    address public curator;
    /// Trading-prediction graduation: only graduated handles can open windows.
    bool public graduated;
    /// Content categories - each a plain small integer the UI maps to a family:
    /// 1 people · 2 crypto · 3 sports · 4 ai · 5 tech · 6 brands · 7 music ·
    /// 8 memes · 9 culture.
    /// A handle may carry more than one (e.g. a person who is also a football
    /// handle). Set by the protocol (backend). `categoriesCount()` exists
    /// because the public getter only exposes one index at a time.
    uint256[] public categories;
    /// Verification status (e.g. an account's identity was KYC/link verified) —
    /// set by the protocol (backend).
    bool public verified;

    // --- revenue (claimed here, not on RevenueSharing) -----------------------
    IERC20 public immutable usdc;

    /// Only the HandleFactory may wire protocol addresses and LP receipts.
    modifier onlyFactory() {
        if (msg.sender != factory) revert Errors.NotFactory();
        _;
    }

    /// Backend/protocol CURRATOR actions (metadata, sources, category, windows,
    /// graduation, updater rotation). The factory always may; otherwise the
    /// dedicated `curator` may — and until one is set the aura updater stands in,
    /// so an existing deployment keeps working while the roles are separated.
    modifier onlyCurator() {
        address allowed = curator == address(0) ? auraUpdater : curator;
        if (msg.sender != factory && msg.sender != allowed) revert Errors.NotCurator();
        _;
    }

    /// Only the reward distributor may credit fees.
    modifier onlyRevenue() {
        if (msg.sender != revenue) revert Errors.NotRevenue();
        _;
    }

    constructor(
        bytes32 _handleId,
        address _owner,
        string memory _name,
        string memory _symbol,
        string memory _metadata,
        uint256 _windowMinutes,
        uint256[] memory _categories,
        address _factory,
        IERC20 _usdc
    ) Ownable(_owner) {
        if (_owner == address(0)) revert Errors.ZeroAddress();
        if (_categories.length == 0) revert Errors.ZeroAmount();
        if (_categories.length > MAX_CATEGORIES) revert Errors.TooManyCategories();
        handleId = _handleId;
        name = _name;
        symbol = _symbol;
        metadata = _metadata;
        windowMinutes = _windowMinutes;
        categories = _categories;
        factory = _factory;
        usdc = _usdc;
        createdAt = block.timestamp;
        emit CategoriesSet(_categories);
    }

    // --- protocol actions ---------------------------------------------------

    function setMetadata(string calldata _metadata) external onlyCurator {
        metadata = _metadata;
        emit MetadataSet(_metadata);
    }

    function setWindowMinutes(uint256 _windowMinutes) external onlyCurator {
        windowMinutes = _windowMinutes;
        emit WindowMinutesSet(_windowMinutes);
    }

    function addSource(string calldata source) external onlyCurator {
        if (sources.length >= MAX_SOURCES) revert Errors.SourceLimit();
        // No duplicates: a repeated config would skew the handle's signal mix and
        // bloat the (copied) SourcesChanged event.
        for (uint256 i = 0; i < sources.length; i++) {
            if (keccak256(bytes(sources[i])) == keccak256(bytes(source))) return;
        }
        sources.push(source);
        emit SourcesChanged(sources);
    }

    function removeSource(uint256 index) external onlyCurator {
        uint256 len = sources.length;
        if (index >= len) revert Errors.BadIndex();
        sources[index] = sources[len - 1];
        sources.pop();
        emit SourcesChanged(sources);
    }

    /// Number of source configs — lets off-chain readers (subgraph, oracle)
    /// enumerate `sources` (Solidity has no dynamic-array length getter).
    function sourcesCount() external view returns (uint256) {
        return sources.length;
    }

    // --- revenue --------------------------------------------------------------

    /// The CREATOR (owner — the only onlyOwner action left) claims their USDC
    /// cut: everything routed to this handle by RevenueSharing
    /// (`usdc.balanceOf(this)`), no per-role tracker.
    function claim() external nonReentrant {
        if (msg.sender != owner()) revert Errors.NotCreator();
        uint256 amount = usdc.balanceOf(address(this));
        if (amount == 0) revert Errors.ZeroAmount();
        usdc.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // --- aura (protocol updater) ----------------------------------------------

    /// Protocol sets who may push the handle's aura (the oracle relayer).
    /// Bootstrapped through the HandleFactory; the current updater may rotate.
    function setAuraUpdater(address updater) external onlyCurator {
        auraUpdater = updater;
        emit AuraUpdaterSet(updater);
    }

    /// Graduate (or un-graduate) the handle for trading prediction. Backend-only.
    function setGraduated(bool ok) external onlyCurator {
        graduated = ok;
        emit GraduatedSet(ok);
    }

    /// Protocol function: push the handle's current aura (1e2 scale) + the AI's
    /// one-line reasoning (indexed for the subgraph's historical aura chart).
    /// Bounded to the protocol's aura range so a compromised updater cannot push
    /// an out-of-range value into the Stake fee curve or the window strikes.
    function updateAura(uint256 _aura, string calldata summary) external {
        if (msg.sender != auraUpdater) revert Errors.NotUpdater();
        if (_aura > MAX_AURA) revert Errors.BadAura();
        aura = _aura;
        emit AuraUpdated(_aura, summary);
    }

    /// Factory wires the dedicated curation role (metadata, sources, category,
    /// verification, graduation). Leaving it unset keeps the aura updater as
    /// curator, so the split can be rolled out per handle.
    function setCurator(address _curator) external onlyFactory {
        curator = _curator;
        emit CuratorSet(_curator);
    }

    /// Backend sets the handle's category codes (1-9).
    /// Replaces the whole set; empty is rejected so a handle always carries one.
    function setCategories(uint256[] calldata _categories) external onlyCurator {
        if (_categories.length == 0) revert Errors.ZeroAmount();
        if (_categories.length > MAX_CATEGORIES) revert Errors.TooManyCategories();
        categories = _categories;
        emit CategoriesSet(_categories);
    }

    /// Number of category codes — lets off-chain readers (subgraph, oracle)
    /// enumerate `categories` (Solidity has no dynamic-array length getter).
    function categoriesCount() external view returns (uint256) {
        return categories.length;
    }

    /// Membership test for a category code (subgraph/tests convenience).
    function hasCategory(uint256 code) external view returns (bool) {
        for (uint256 i = 0; i < categories.length; i++) {
            if (categories[i] == code) return true;
        }
        return false;
    }

    /// Backend marks the handle verified (e.g. identity link confirmed).
    function setVerified(bool ok) external onlyCurator {
        verified = ok;
        emit VerifiedSet(ok);
    }

    // --- factory wiring ------------------------------------------------------

    /// Wire the global MarketMaker as the handle's market and whitelist it on
    /// the handle's Pool.
    function setMarketByFactory(address _market) external onlyFactory {
        market = _market;
    }

    function setOracleFactory(address _oracleFactory) external onlyFactory {
        oracleFactory = _oracleFactory;
        emit OracleFactorySet(_oracleFactory);
    }

    function setRevenue(address _revenue) external onlyFactory {
        revenue = _revenue;
        emit RevenueSet(_revenue);
    }

    function setStake(address _stake) external onlyFactory {
        stake = _stake;
        emit StakeSet(_stake);
    }
}
