// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOracleFactory} from "./interfaces/IOracleFactory.sol";
import {IAuraOracle} from "./spec/IAuraOracle.sol";
import {IMarketMaker} from "./interfaces/IMarketMaker.sol";
import {IRevenueSharing} from "./interfaces/IRevenueSharing.sol";
import {IOrderBook} from "./interfaces/IOrderBook.sol";
import {Errors} from "./libraries/Errors.sol";
import {Constants} from "./libraries/Constants.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OrderBook
/// @notice Limit-order exchange for IndexMarket binary UP/DOWN shares. Makers
///         post buy/sell orders (buy escrows USDC, sell escrows the window's
///         shares); takers run market orders with slippage protection that fill
///         the specific resting orders they route OFF-CHAIN. Matches shares
///         between parties — the market itself is the oracle-priced counterparty.
contract OrderBook is IOrderBook, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IOracleFactory public immutable oracleFactory;
    IMarketMaker public immutable market;
    IERC20 public immutable collateral;
    IRevenueSharing public immutable revenue;
    uint256 public immutable feeBips; // trading fee to RevenueSharing (bps)

    bytes32 public nextOrderId;
    mapping(bytes32 => Order) public orders;

    constructor(IOracleFactory _oracleFactory, IMarketMaker _market, IERC20 _collateral, IRevenueSharing _revenue, uint256 _feeBips) {
        oracleFactory = _oracleFactory;
        market = _market;
        collateral = _collateral;
        revenue = _revenue;
        feeBips = _feeBips;
    }

    function _checkOracle(IAuraOracle oracle) internal view {
        if (address(oracle) != oracleFactory.oracleOf(oracle.handleId(), oracle.windowStart()))
            revert Errors.BadOracle();
    }

    function isActive(bytes32 id) public view returns (bool) {
        Order storage o = orders[id];
        if (o.maker == address(0) || o.cancelled) return false;
        if (o.filled >= o.size) return false;
        if (o.expiresAt != 0 && o.expiresAt < block.timestamp) return false;
        return true;
    }

    function remainingOf(bytes32 id) public view returns (uint256) {
        Order storage o = orders[id];
        return o.size > o.filled ? o.size - o.filled : 0;
    }

    function orderOf(bytes32 id) external view returns (Order memory) {
        return orders[id];
    }

    /// Place a limit order on a window's UP/DOWN shares. Buys escrow USDC
    /// (size·price); sells escrow `size` shares (transferred in from the maker).
    function placeOrder(
        IAuraOracle oracle,
        uint256 outcome,
        bool side,
        uint256 price,
        uint256 size,
        uint256 expiresAt
    ) external returns (bytes32) {
        _checkOracle(oracle);
        bytes32 handleId = oracle.handleId();
        if (!market.isOpen(oracle)) revert Errors.WindowNotOpen();
        if (price == 0 || price >= Constants.ONE) revert Errors.BadPrice();
        if (size == 0) revert Errors.ZeroAmount();
        if (side) {
            uint256 escrow = (size * price) / Constants.ONE;
            collateral.safeTransferFrom(msg.sender, address(this), escrow);
        } else {
            market.transferFrom(msg.sender, address(this), oracle, outcome, size);
        }
        bytes32 id = nextOrderId;
        nextOrderId = bytes32(uint256(nextOrderId) + 1);
        orders[id] = Order(msg.sender, address(oracle), outcome, side, price, size, 0, expiresAt, false);
        emit OrderPlaced(handleId, address(oracle), outcome, side, msg.sender, id, price, size, expiresAt);
        return id;
    }

    /// Cancel an unfilled order and return its escrow.
    function cancelOrder(IAuraOracle oracle, bytes32 id) external nonReentrant {
        _checkOracle(oracle);
        Order storage o = orders[id];
        if (o.maker != msg.sender) revert Errors.NotMaker();
        if (o.cancelled) revert Errors.OrderCancelled();
        uint256 unfilled = remainingOf(id);
        o.cancelled = true;
        if (unfilled > 0) _returnEscrow(o, unfilled);
        emit OrderCancelled(oracle.handleId(), address(oracle), id);
    }

    /// Update price / size / expiry of a resting order (re-escrows the delta).
    function updateOrder(
        IAuraOracle oracle,
        bytes32 id,
        uint256 price,
        uint256 size,
        uint256 expiresAt
    ) external nonReentrant {
        _checkOracle(oracle);
        Order storage o = orders[id];
        if (o.maker != msg.sender) revert Errors.NotMaker();
        if (o.cancelled || !isActive(id)) revert Errors.OrderNotActive();
        if (price == 0 || price >= Constants.ONE) revert Errors.BadPrice();
        if (size < o.filled) revert Errors.BadSize();

        uint256 prevRemaining = remainingOf(id);
        uint256 prevPrice = o.price;
        o.price = price;
        o.size = size;
        o.expiresAt = expiresAt;
        uint256 newRemaining = size - o.filled;

        if (newRemaining >= prevRemaining) {
            uint256 add = (newRemaining * price - prevRemaining * prevPrice) / Constants.ONE;
            if (o.side) {
                collateral.safeTransferFrom(msg.sender, address(this), add);
            } else {
                market.transferFrom(msg.sender, address(this), oracle, o.outcome, newRemaining - prevRemaining);
            }
        } else {
            uint256 refund = (prevRemaining * prevPrice - newRemaining * price) / Constants.ONE;
            if (o.side) {
                collateral.safeTransfer(msg.sender, refund);
            } else {
                market.transfer(msg.sender, oracle, o.outcome, prevRemaining - newRemaining);
            }
        }
        emit OrderUpdated(oracle.handleId(), address(oracle), id, price, size, expiresAt);
    }

    /// Taker order that fills explicitly-routed resting orders. The heavy lifting
    /// (discovering + ranking the best book) is done OFF-CHAIN by the indexer;
    /// the taker submits the specific order ids and the contract fills them up to
    /// `amount`, enforcing limitPrice + minFill. No on-chain order list.
    function marketOrder(
        IAuraOracle oracle,
        uint256 outcome,
        bool side,
        bytes32[] calldata orderIds,
        uint256 amount,
        uint256 limitPrice,
        uint256 minFill
    ) external nonReentrant returns (uint256 filled) {
        _checkOracle(oracle);
        bytes32 handleId = oracle.handleId();
        if (!market.isOpen(oracle)) revert Errors.WindowNotOpen();
        if (amount == 0) revert Errors.ZeroAmount();
        uint256 remaining = amount;
        filled = 0;
        for (uint256 i = 0; i < orderIds.length && remaining > 0; i++) {
            bytes32 id = orderIds[i];
            Order storage o = orders[id];
            if (
                o.maker == address(0) ||
                o.oracle != address(oracle) ||
                o.outcome != outcome ||
                !isActive(id)
            ) continue;
            uint256 oPrice = o.price;
            if (side) {
                if (oPrice > limitPrice) continue; // above the taker's limit
            } else {
                if (oPrice < limitPrice) continue; // below the taker's limit
            }
            uint256 take = remaining < (o.size - o.filled) ? remaining : (o.size - o.filled);
            filled += take;
            remaining -= take;
            _fill(oracle, id, o, take, oPrice, side);
            if (o.size == o.filled) {
                o.cancelled = true;
                emit OrderCancelled(handleId, address(oracle), id);
            }
        }
        if (filled < minFill) revert Errors.BelowMinFill();
    }

    function _fill(
        IAuraOracle oracle,
        bytes32 id,
        Order storage o,
        uint256 take,
        uint256 price,
        bool takerSide
    ) internal {
        uint256 gross = (take * price) / Constants.ONE;
        uint256 fee = (gross * feeBips) / 10_000;
        uint256 net = gross - fee;
        o.filled += take;
        if (takerSide) {
            // Taker buys; maker sells (maker escrowed shares).
            collateral.safeTransferFrom(msg.sender, address(this), gross);
            collateral.safeTransfer(o.maker, net);
            _routeFee(oracle.handleId(), fee);
            market.transfer(msg.sender, oracle, o.outcome, take);
        } else {
            // Taker sells; maker buys (maker escrowed USDC).
            market.transferFrom(msg.sender, address(this), oracle, o.outcome, take);
            market.transfer(o.maker, oracle, o.outcome, take);
            collateral.safeTransfer(msg.sender, net);
            _routeFee(oracle.handleId(), fee);
        }
        emit OrderFilled(oracle.handleId(), address(oracle), id, msg.sender, o.outcome, take, price);
    }

    function _routeFee(bytes32 handleId, uint256 fee) internal {
        if (fee > 0) {
            collateral.forceApprove(address(revenue), fee);
            revenue.depositFees(handleId, fee);
        }
    }

    function _returnEscrow(Order storage o, uint256 shares) internal {
        if (o.side) {
            uint256 escrow = (shares * o.price) / Constants.ONE;
            collateral.safeTransfer(o.maker, escrow);
        } else {
            market.transfer(o.maker, IAuraOracle(o.oracle), o.outcome, shares);
        }
    }
}