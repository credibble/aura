// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOracleFactory} from "./interfaces/IOracleFactory.sol";
import {IAuraOracle} from "./spec/IAuraOracle.sol";
import {IMarketMaker} from "./interfaces/IMarketMaker.sol";
import {IRevenueSharing} from "./interfaces/IRevenueSharing.sol";
import {IHandleFactory} from "./interfaces/IHandleFactory.sol";
import {IConfigurator} from "./interfaces/IConfigurator.sol";
import {Pool} from "./Pool.sol";
import {Handle} from "./Handle.sol";
import {OutcomeToken} from "./tokens/OutcomeToken.sol";
import {MathLib} from "./libraries/MathLib.sol";
import {Constants} from "./libraries/Constants.sol";
import {Errors} from "./libraries/Errors.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title MarketMaker
/// @notice The nth-outcome prediction market — the Aura core. A window is a
///         fixed-threshold binary ("Will Aura close above the strike?") OR a
///         winner-takes-all categorical market ("Who gains the most Aura?"),
///         priced by an LMSR AMM: every outcome's price is its probability and
///         all prices sum to 1. A winning share pays 1 USDC. The singleton Pool
///         vault backs each window (house-seeded at openWindow); LPs earn the
///         fee cut. The relayer seeds the strike from the EMA baseline of past
///         windows and settles the final per-outcome indices (winner = argmax).
contract MarketMaker is IMarketMaker, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 internal constant ONE = Constants.ONE;
    /// Exponent cap: e^(q/b) beyond ~20 is treated as infinite (price ≈ 1/0).
    uint256 internal constant MAX_EXP = 20 * Constants.ONE;

    IOracleFactory public immutable oracleFactory;
    IERC20 public immutable collateral;
    IRevenueSharing public immutable revenue;
    IHandleFactory public immutable handleFactory;
    IConfigurator public immutable configurator; // protocol-level rules (window bounds)
    uint256 public immutable feeBips; // trading fee to RevenueSharing (bps)
    uint256 public immutable maxOutcomes; // hard cap (e.g. 20)

    struct Window {
        bytes32 handleId;
        uint256 windowStart; // epoch seconds
        uint256 windowEnd; // epoch seconds
        uint256 liquidity; // b (LMSR depth, 1e18) = funding / ln(n)
        string[] outcomes;
        string[] metadata; // per-outcome metadata (passed in at openWindow)
        uint256[] q; // outstanding shares per outcome (1e18)
        uint256 cash; // USDC in the window
        bool settled;
        uint256 winningOutcome;
    }

    mapping(address => Window) public windows; // keyed by window oracle address
    mapping(address => mapping(address => mapping(uint256 => uint256)))
        public shares; // user -> oracle -> outcome -> shares
    mapping(address => mapping(address => mapping(uint256 => uint256)))
        public allowances; // owner -> oracle -> outcome -> amount
    /// Per (window oracle, outcome) transferable ERC20 receipts.
    mapping(address => mapping(uint256 => OutcomeToken)) public outcomeTokens;

    event WindowOpened(
        bytes32 indexed handleId,
        address indexed oracle,
        uint256 windowStart,
        uint256 windowEnd,
        string[] outcomes,
        uint256[] probabilities,
        uint256 funding
    );
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

    modifier onlyOracle() {
        if (msg.sender != oracleFactory.signer()) revert Errors.NotOracle();
        _;
    }

    constructor(
        IOracleFactory _oracleFactory,
        IERC20 _collateral,
        IRevenueSharing _revenue,
        IHandleFactory _handleFactory,
        IConfigurator _configurator,
        uint256 _feeBips,
        uint256 _maxOutcomes
    ) {
        oracleFactory = _oracleFactory;
        collateral = _collateral;
        revenue = _revenue;
        handleFactory = _handleFactory;
        configurator = _configurator;
        feeBips = _feeBips;
        maxOutcomes = _maxOutcomes;
    }

    // --- oracle (relayer) functions -----------------------------------------

    /// Open a window: deploy the window oracle, name the outcomes, seed the
    /// LMSR with INITIAL PROBABILITIES (1e18 each, Σ = 1e18), and reserve
    /// `funding` from the singleton Pool (house-seeded; LPs are the
    /// counterparty). LMSR depth b = funding/ln(n) so the reserve bounds the
    /// market maker's max loss (b·ln(n) = funding). The relayer prices the
    /// open (e.g. 50/50 binary, or aura-weighted priors for a multi market).
    function openWindow(
        bytes32 handleId,
        uint256 windowStart,
        uint256 windowEnd,
        string[] calldata outcomes,
        string[] calldata metadata,
        uint256[] calldata probabilities,
        string calldata oracleMetadata,
        uint256 funding
    ) external onlyOracle {
        // Only GRADUATED handles can open trading windows.
        if (!Handle(handleFactory.handleOf(handleId)).graduated()) revert Errors.NotGraduated();
        if (windowEnd <= windowStart) revert Errors.BadWindow();
        if (windowEnd - windowStart < configurator.minWindowSeconds()) revert Errors.BadWindow();
        uint256 n = outcomes.length;
        if (n < 2 || n > maxOutcomes) revert Errors.TooManyOutcomes();
        if (metadata.length != n) revert Errors.BadOutcome();
        if (probabilities.length != n) revert Errors.BadOutcome();
        if (funding == 0) revert Errors.ZeroAmount();

        // Probabilities must be 1e18-scaled, sum to 1e18, each within (0, 1e18].
        // A zero leg is rejected: seeding q_i = 0 would price it at e^0/Σ > 0,
        // contradicting the relayer's priors.
        uint256 sum = 0;
        for (uint256 i = 0; i < n; i++) {
            if (probabilities[i] == 0 || probabilities[i] > Constants.ONE)
                revert Errors.BadProbabilities();
            sum += probabilities[i];
        }
        if (sum != Constants.ONE) revert Errors.BadOutcome();

        IAuraOracle oracle = IAuraOracle(
            address(oracleFactory.deployOracle(handleId, windowStart, oracleMetadata))
        );
        Window storage w = windows[address(oracle)];
        if (w.windowEnd != 0) revert Errors.WindowAlreadyOpen();
        w.handleId = handleId;
        w.windowStart = windowStart;
        w.windowEnd = windowEnd;
        for (uint256 i = 0; i < n; i++) {
            w.outcomes.push(outcomes[i]);
            w.metadata.push(metadata[i]);
        }
        w.q = new uint256[](n);
        // b = funding / ln(n) → MaxLoss = b·ln(n) ≈ funding. Must be non-zero:
        // `priceOf`/`_lmsrCost` divide by it, so a dust b would brick the window.
        int256 lnN = MathLib.ln(n * ONE);
        w.liquidity = lnN > 0 ? (funding * ONE) / uint256(lnN) : funding;
        if (w.liquidity == 0) revert Errors.InsufficientLiquidity();
        // Seed the LMSR state so initial prices equal `probabilities`:
        //   q_i = b · ln(p_i / p_min)  ⇒  price_i = e^(q_i/b)/Σ e^(q_j/b) = p_i.
        uint256 pMin = type(uint256).max;
        for (uint256 i = 0; i < n; i++) {
            if (probabilities[i] > 0 && probabilities[i] < pMin) pMin = probabilities[i];
        }
        for (uint256 i = 0; i < n; i++) {
            if (probabilities[i] == 0) {
                w.q[i] = 0;
                continue;
            }
            int256 lr = MathLib.ln((probabilities[i] * ONE) / pMin); // ln(p_i/p_min)·1e18 ≥ 0
            w.q[i] = (w.liquidity * uint256(lr)) / ONE;
        }
        address pool = _windowPool(handleId);
        if (pool == address(0)) {
            collateral.safeTransferFrom(msg.sender, address(this), funding);
        } else {
            Pool(pool).reserve(address(oracle), funding); // auraLP backs it (oracle key)
        }
        w.cash = funding;
        // The oracle's real bounds are confirmed here (the signer relays it), so
        // resolution can't be submitted early, and any metadata a squatter put on
        // a pre-deployed oracle is overwritten with the protocol's.
        oracle.confirmWindow(windowEnd, oracleMetadata);
        emit WindowOpened(handleId, address(oracle), windowStart, windowEnd, outcomes, probabilities, funding);
    }

    /// Settle: the ORACLE's own on-chain resolution is the authority. The relayer
    /// submits a signed receipt to the window's Oracle first (which enforces the
    /// window's end time), and this call only mirrors the outcome the Oracle
    /// already recorded — a settlement can never disagree with the receipt.
    /// Binary windows: the outcome index must match the receipt's direction.
    function settle(IAuraOracle oracle, uint256 winningOutcome) external onlyOracle {
        _checkOracle(oracle);
        Window storage w = windows[address(oracle)];
        if (w.windowEnd == 0) revert Errors.WindowNotOpened();
        if (w.settled) revert Errors.AlreadySettled();
        if (winningOutcome >= w.outcomes.length) revert Errors.BadOutcome();
        // The window cannot settle before it has ended.
        if (block.timestamp < w.windowEnd) revert Errors.TooEarly();
        // The Oracle must carry a verified resolution (signed receipt).
        if (oracle.windowStatus() != IAuraOracle.WindowStatus.RESOLVED)
            revert Errors.OracleNotResolved();
        (bool direction, , , ) = oracle.resolutionOf();
        // Binary: direction is the whole truth — index 0 = up/YES, 1 = down/NO.
        if (w.outcomes.length == 2) {
            uint256 derived = direction ? 0 : 1;
            if (winningOutcome != derived) revert Errors.BadOutcome();
        }
        w.settled = true;
        w.winningOutcome = winningOutcome;
        emit Settled(w.handleId, address(oracle), winningOutcome);
    }

    /// Release the window's remaining auraLP reserve after claims have had their
    /// grace period. Permissionless by design (it can only return capacity to the
    /// Pool), but time-gated so it cannot strand claims that still need it.
    /// Works for SETTLED and VOIDED windows — a voided window must also be able
    /// to hand its capacity back once refunds are done.
    function finalize(IAuraOracle oracle) external nonReentrant {
        _checkOracle(oracle);
        Window storage w = windows[address(oracle)];
        if (w.windowEnd == 0) revert Errors.WindowNotOpened();
        bool voided = oracle.windowStatus() == IAuraOracle.WindowStatus.VOIDED;
        if (!w.settled && !voided) revert Errors.NotSettled();
        if (block.timestamp < w.windowEnd + configurator.settlementGraceSeconds())
            revert Errors.TooEarly();
        address pool = _windowPool(w.handleId);
        if (pool == address(0)) return;
        uint256 remaining = Pool(pool).reserved(address(oracle));
        Pool(pool).unreserve(address(oracle), remaining);
    }

    /// Refund a VOIDED window — no resolution exists, so nobody won.
    ///
    /// The holder exits at the live LMSR value of their ENTIRE position, fee-free
    /// (the position's marginal value, which is what the market can pay: a void
    /// cannot pay both sides at par). Per-outcome payouts are computed against the
    /// frozen state before any mutation, so the result doesn't depend on who
    /// redeems first.
    function redeemVoid(IAuraOracle oracle) external nonReentrant {
        _checkOracle(oracle);
        Window storage w = windows[address(oracle)];
        if (w.windowEnd == 0) revert Errors.WindowNotOpened();
        if (w.settled) revert Errors.AlreadySettled();
        if (block.timestamp < w.windowEnd) revert Errors.TooEarly();
        if (oracle.windowStatus() != IAuraOracle.WindowStatus.VOIDED)
            revert Errors.OracleNotResolved();

        uint256 n = w.outcomes.length;
        uint256 total = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 held = shares[msg.sender][address(oracle)][i];
            if (held == 0) continue;
            total += sellProceeds(oracle, i, held);
        }
        if (total == 0) revert Errors.NothingToRedeem();

        // Burn every leg, then pay once.
        for (uint256 i = 0; i < n; i++) {
            uint256 held = shares[msg.sender][address(oracle)][i];
            if (held == 0) continue;
            shares[msg.sender][address(oracle)][i] = 0;
            w.q[i] = w.q[i] > held ? w.q[i] - held : 0;
            _moveToken(oracle, i, msg.sender, address(0), held);
        }
        w.cash = w.cash > total ? w.cash - total : 0;
        _fundPayout(oracle, w.handleId, msg.sender, total);
        emit VoidRedeemed(w.handleId, address(oracle), msg.sender, total);
    }

    // --- LMSR pricing -------------------------------------------------------

    /// LMSR price of an outcome: e^(q_i/b) / Σ e^(q_j/b) ∈ [0,1].
    function priceOf(IAuraOracle oracle, uint256 outcome) public view returns (uint256) {
        Window storage w = windows[address(oracle)];
        uint256 n = w.outcomes.length;
        if (n == 0) return 0;
        uint256 maxE = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 e = (w.q[i] * ONE) / w.liquidity;
            if (e > maxE) maxE = e;
        }
        uint256 num = 0;
        uint256 denom = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 e = (w.q[i] * ONE) / w.liquidity;
            uint256 shifted = maxE > e ? maxE - e : 0;
            uint256 ex = _expNeg(shifted);
            if (i == outcome) num = ex;
            denom += ex;
        }
        return denom == 0 ? 0 : (num * ONE) / denom;
    }

    // --- outcome token receipts -----------------------------------------------

    /// Lazily deploy (or return) the transferable OutcomeToken ERC20 for a
    /// (window oracle, outcome) — its metadata string describes the position.
    function _outcomeToken(IAuraOracle oracle, uint256 outcome) internal returns (OutcomeToken) {
        OutcomeToken existing = outcomeTokens[address(oracle)][outcome];
        if (address(existing) != address(0)) return existing;
        Window storage w = windows[address(oracle)];
        string memory meta = w.metadata[outcome]; // passed in at openWindow
        string memory name = string.concat("Aura ", Strings.toString(outcome), " Outcome");
        string memory symbol = string.concat("AU-", Strings.toString(outcome));
        OutcomeToken token = new OutcomeToken(name, symbol, meta, address(oracle), outcome);
        outcomeTokens[address(oracle)][outcome] = token;
        emit OutcomeTokenDeployed(address(oracle), outcome, address(token));
        return token;
    }

    /// Move OutcomeToken shares: burn from `from`, mint to `to` (either may be 0).
    function _moveToken(IAuraOracle oracle, uint256 outcome, address from, address to, uint256 q) internal {
        if (q == 0) return;
        OutcomeToken token = _outcomeToken(oracle, outcome);
        if (from != address(0)) token.burn(from, q);
        if (to != address(0)) token.mint(to, q);
    }

    /// OutcomeToken receipt for a (window oracle, outcome), or zero-address.
    function outcomeTokenOf(IAuraOracle oracle, uint256 outcome) external view returns (OutcomeToken) {
        return outcomeTokens[address(oracle)][outcome];
    }

    /// Cost to mint `delta` shares of an outcome: C(q+Δ) − C(q).
    function buyCost(IAuraOracle oracle, uint256 outcome, uint256 delta) public view returns (uint256) {
        Window storage w = windows[address(oracle)];
        uint256 n = w.outcomes.length;
        uint256[] memory q = _copyQ(w, n);
        uint256 costBefore = _lmsrCost(q, w.liquidity, n);
        q[outcome] += delta;
        uint256 costAfter = _lmsrCost(q, w.liquidity, n);
        return costAfter > costBefore ? costAfter - costBefore : 0;
    }

    /// Proceeds from selling `delta` shares: C(q) − C(q−Δ).
    function sellProceeds(IAuraOracle oracle, uint256 outcome, uint256 delta) public view returns (uint256) {
        Window storage w = windows[address(oracle)];
        uint256 n = w.outcomes.length;
        uint256[] memory q = _copyQ(w, n);
        uint256 costBefore = _lmsrCost(q, w.liquidity, n);
        q[outcome] = q[outcome] > delta ? q[outcome] - delta : 0;
        uint256 costAfter = _lmsrCost(q, w.liquidity, n);
        return costBefore > costAfter ? costBefore - costAfter : 0;
    }

    /// C(q) = b·ln(Σ e^{q_i/b}), computed with a max-exponent shift.
    function _lmsrCost(uint256[] memory q, uint256 b, uint256 n) internal pure returns (uint256) {
        uint256 maxE = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 e = (q[i] * ONE) / b;
            if (e > maxE) maxE = e;
        }
        uint256 sum = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 e = (q[i] * ONE) / b;
            uint256 shifted = maxE > e ? maxE - e : 0;
            sum += _expNeg(shifted);
        }
        int256 lnSum = MathLib.ln(sum);
        // C = b·maxE + b·lnSum  (maxE, lnSum and b all 1e18)
        return (b * maxE) / ONE + (b * uint256(lnSum)) / ONE;
    }

    /// e^{-x} in 1e18 (x 1e18); 1/exp(x) = ONE²/exp(x), capped at 0.
    function _expNeg(uint256 x18) internal pure returns (uint256) {
        if (x18 > MAX_EXP) return 0;
        uint256 ex = MathLib.exp(x18);
        return ex == 0 ? 0 : (ONE * ONE) / ex;
    }

    function _copyQ(Window storage w, uint256 n) internal view returns (uint256[] memory q) {
        q = new uint256[](n);
        for (uint256 i = 0; i < n; i++) q[i] = w.q[i];
    }

    // --- trading ------------------------------------------------------------

    /// Buy `amountIn`-worth of `outcome`, paying the EXACT LMSR cost.
    ///
    /// The spot price is the tangent of a convex cost curve, so filling at
    /// amountIn/price underpays on any real size — a buyer could then sell the
    /// same shares back for a profit. Here the estimate is corrected against
    /// `buyCost` (bounded loop), the trader pays exactly `cost + fee`, and the
    /// unspent remainder of their budget is simply never pulled.
    function buy(
        IAuraOracle oracle,
        uint256 outcome,
        uint256 amountIn,
        uint256 minShares
    ) external nonReentrant {
        _checkOracle(oracle);
        Window storage w = windows[address(oracle)];
        if (w.windowEnd == 0) revert Errors.WindowNotOpened();
        if (!_live(w)) revert Errors.WindowNotOpen();
        if (amountIn == 0) revert Errors.ZeroInput();
        if (outcome >= w.outcomes.length) revert Errors.BadOutcome();
        uint256 price = priceOf(oracle, outcome);
        if (price == 0 || price >= ONE) revert Errors.BadPrice();

        // Start from the spot estimate, then shrink until cost + fee fits the
        // budget (converges in a couple of rounds; 4 is the hard cap).
        uint256 delta = (amountIn * ONE) / price;
        uint256 cost = buyCost(oracle, outcome, delta);
        for (uint256 i = 0; i < 4; i++) {
            if (cost == 0) break;
            uint256 need = cost + (cost * feeBips) / 10_000;
            if (need <= amountIn) break;
            delta = (delta * amountIn) / need;
            cost = buyCost(oracle, outcome, delta);
        }
        uint256 fee = (cost * feeBips) / 10_000;
        if (cost == 0 || cost + fee > amountIn) revert Errors.BadPrice();
        if (delta < minShares) revert Errors.DustShares();

        collateral.safeTransferFrom(msg.sender, address(this), cost + fee);
        address pool = _windowPool(w.handleId);
        if (pool != address(0)) {
            // The trader's USDC backs this window's payouts: send it to the Pool
            // and reserve it against the oracle (so claims draw on capacity that
            // actually exists, instead of this contract's shared balance).
            collateral.safeTransfer(pool, cost);
            Pool(pool).reserve(address(oracle), cost);
        }
        w.q[outcome] += delta;
        w.cash += cost;
        shares[msg.sender][address(oracle)][outcome] += delta;
        _moveToken(oracle, outcome, address(0), msg.sender, delta);
        _routeFee(oracle, w.handleId, fee);
        emit Bought(w.handleId, address(oracle), msg.sender, outcome, cost + fee, delta, price);
    }

    function sell(
        IAuraOracle oracle,
        uint256 outcome,
        uint256 delta,
        uint256 minProceeds
    ) external nonReentrant {
        _checkOracle(oracle);
        Window storage w = windows[address(oracle)];
        if (w.windowEnd == 0) revert Errors.WindowNotOpened();
        if (!_live(w)) revert Errors.WindowNotOpen();
        uint256 held = shares[msg.sender][address(oracle)][outcome];
        if (delta > held) revert Errors.InsufficientShares();
        uint256 proceeds = sellProceeds(oracle, outcome, delta);
        if (proceeds < minProceeds) revert Errors.BelowMinFill();
        if (proceeds > w.cash) revert Errors.LedgerShort();
        shares[msg.sender][address(oracle)][outcome] = held - delta;
        w.q[outcome] = w.q[outcome] > delta ? w.q[outcome] - delta : 0;
        _moveToken(oracle, outcome, msg.sender, address(0), delta);
        w.cash -= proceeds;
        uint256 fee = (proceeds * feeBips) / 10_000;
        _fundPayout(oracle, w.handleId, msg.sender, proceeds - fee);
        _routeFee(oracle, w.handleId, fee);
        emit Sold(w.handleId, address(oracle), msg.sender, outcome, delta, proceeds);
    }

    function claim(IAuraOracle oracle, uint256 outcome) external nonReentrant {
        _checkOracle(oracle);
        Window storage w = windows[address(oracle)];
        if (w.windowEnd == 0) revert Errors.WindowNotOpened();
        if (!w.settled) revert Errors.NotSettled();
        if (outcome != w.winningOutcome) revert Errors.NothingToRedeem();
        uint256 held = shares[msg.sender][address(oracle)][outcome];
        if (held == 0) revert Errors.NothingToRedeem();
        // No `held > w.cash` precondition: the window's cash may have been paid
        // out by sellers while the Pool still holds reserved capacity for the
        // winner. `_fundPayout` sources from the window's reserve, so a claim is
        // always payable.
        shares[msg.sender][address(oracle)][outcome] = 0;
        w.q[outcome] = w.q[outcome] > held ? w.q[outcome] - held : 0;
        _moveToken(oracle, outcome, msg.sender, address(0), held);
        w.cash = w.cash > held ? w.cash - held : 0;
        _fundPayout(oracle, w.handleId, msg.sender, held);
        emit Claimed(w.handleId, address(oracle), msg.sender, outcome, held, held);
    }

    // --- share transfers (for the order book) --------------------------------

    function isOpen(IAuraOracle oracle) external view returns (bool) {
        Window storage w = windows[address(oracle)];
        return w.windowEnd != 0 && block.timestamp < w.windowEnd;
    }

    function approve(IAuraOracle oracle, uint256 outcome, uint256 amount) external {
        allowances[msg.sender][address(oracle)][outcome] = amount;
        emit Approved(msg.sender, address(oracle), outcome, amount);
    }

    function transfer(address to, IAuraOracle oracle, uint256 outcome, uint256 q) external {
        _transfer(msg.sender, to, oracle, outcome, q);
    }

    function transferFrom(address from, address to, IAuraOracle oracle, uint256 outcome, uint256 q) external {
        uint256 allowed = allowances[from][address(oracle)][outcome];
        if (allowed != type(uint256).max) {
            if (allowed < q) revert Errors.NotApproved();
            allowances[from][address(oracle)][outcome] = allowed - q;
        }
        _transfer(from, to, oracle, outcome, q);
    }

    // --- internal helpers ----------------------------------------------------

    /// A window is tradable only while LIVE **and unsettled** — before its close
    /// padding (last-second gaming) and never after settlement (the winner would
    /// be public knowledge, letting anyone buy the winner below par).
    function _live(Window storage w) internal view returns (bool) {
        if (w.windowEnd == 0 || w.settled) return false;
        uint256 cut = configurator.windowPadding();
        return block.timestamp < (w.windowEnd > cut ? w.windowEnd - cut : 0);
    }

    /// Keep a liquidity reserve: cash must cover cost + the pool's backing.
    function _margin(Window storage w) internal view returns (uint256) {
        return w.liquidity;
    }

    function _transfer(address from, address to, IAuraOracle oracle, uint256 outcome, uint256 q) internal {
        _checkOracle(oracle);
        Window storage w = windows[address(oracle)];
        if (w.windowEnd == 0) revert Errors.WindowNotOpened();
        if (!_live(w)) revert Errors.WindowNotOpen();
        uint256 held = shares[from][address(oracle)][outcome];
        if (q > held) revert Errors.InsufficientShares();
        shares[from][address(oracle)][outcome] = held - q;
        shares[to][address(oracle)][outcome] += q;
        _moveToken(oracle, outcome, from, to, q);
        emit Transferred(from, to, address(oracle), outcome, q);
    }

    function _checkOracle(IAuraOracle oracle) internal view {
        if (
            address(oracle) !=
            oracleFactory.oracleOf(oracle.handleId(), oracle.windowStart())
        ) revert Errors.BadOracle();
    }

    function _windowPool(bytes32 handleId) internal view returns (address) {
        return handleFactory.poolOf(handleId);
    }

    function _routeFee(IAuraOracle oracle, bytes32 handleId, uint256 fee) internal {
        if (fee == 0) return;
        uint256 bal = collateral.balanceOf(address(this));
        if (bal >= fee) {
            collateral.forceApprove(address(revenue), fee);
            revenue.depositFees(handleId, fee);
            return;
        }
        address pool = _windowPool(handleId);
        if (pool == address(0)) revert Errors.LedgerShort();
        if (bal > 0) {
            collateral.forceApprove(address(revenue), bal);
            revenue.depositFees(handleId, bal);
        }
        Pool(pool).payout(address(oracle), address(revenue), fee - bal);
        revenue.bankFees(handleId); // sweep the pre-paid USDC
    }

    /// Pay a trader their proceeds/claim. With a Pool wired, the money comes
    /// from THIS window's reserved capacity (per-oracle accounting, not the
    /// contract's shared balance); standalone deployments fall back to the
    /// contract balance.
    function _fundPayout(IAuraOracle oracle, bytes32 handleId, address to, uint256 amount) internal {
        if (amount == 0) return;
        address pool = _windowPool(handleId);
        if (pool != address(0)) {
            Pool(pool).payout(address(oracle), to, amount);
            return;
        }
        if (collateral.balanceOf(address(this)) < amount) revert Errors.LedgerShort();
        collateral.safeTransfer(to, amount);
    }
}