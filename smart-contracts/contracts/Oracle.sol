// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAuraOracle} from "./spec/IAuraOracle.sol";
import {ResolutionReceiptLib} from "./spec/ResolutionReceiptLib.sol";
import {IMarketRegistry} from "./interfaces/IMarketRegistry.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title Oracle
/// @notice A dedicated resolution authority for ONE (handleId, windowStart)
///         window — every window is its own oracle. It holds
///         its own OPEN -> FROZEN -> RESOLVED | VOIDED state machine, its own
///         trusted EIP-712 signer, and its own resolution, so every window
///         settles fully independently. Deployed by the OracleFactory.
contract Oracle is IAuraOracle {
    using ResolutionReceiptLib for ResolutionReceipt;

    address public immutable oracleSigner;
    uint256 public immutable chainId;
    bytes32 public immutable handleId;
    uint256 public immutable windowStart;
    /// The MarketMaker that owns this window — the only other account (besides
    /// the signer) allowed to confirm the window's bounds.
    address public immutable market;

    /// Window metadata (JSON string), set at deployment — e.g.
    /// `{"handle":"btc","windowStart":"…","windowEnd":"…","strike":"5000",
    ///   "outcomes":["YES","NO"]}`. Off-chain indexers / the frontend read it.
    string public metadata;

    /// The window's end (epoch seconds), confirmed by the oracle signer when the
    /// market opens it. Immutable once set, so resolution cannot be submitted
    /// before the window has actually ended. 0 = not confirmed (legacy/standalone
    /// deployments, where no time gate can be inferred).
    uint256 public windowEnd;

    WindowStatus private _status;
    Resolution private _resolution;

    struct Resolution {
        bool direction;
        uint256 indexClose;
        bytes32 resolutionHash;
        uint256 resolvedAt;
    }

    modifier onlyOracle() {
        if (msg.sender != oracleSigner) revert Errors.NotOracle();
        _;
    }

    constructor(
        bytes32 _handleId,
        uint256 _windowStart,
        address _oracleSigner,
        address _registry,
        address _market,
        string memory _metadata
    ) {
        handleId = _handleId;
        windowStart = _windowStart;
        oracleSigner = _oracleSigner;
        market = _market;
        metadata = _metadata;
        chainId = block.chainid;
        if (!IMarketRegistry(_registry).isRegistered(_handleId))
            revert Errors.UnregisteredHandle();
    }

    /// Lock trading ahead of resolution (closing-only window).
    function freezeWindow() external onlyOracle {
        if (_status != WindowStatus.OPEN) revert Errors.WindowNotOpen();
        _status = WindowStatus.FROZEN;
        emit WindowFrozen(handleId, windowStart);
    }

    /// Confirm the window's real bounds + canonical metadata. Called by the
    /// MarketMaker when the window opens (the signer may also relay it), which
    /// also overwrites any metadata set at deployment.
    /// One-shot: the first confirmation wins, so the end can't be pushed around.
    function confirmWindow(uint256 _windowEnd, string calldata _metadata) external {
        if (msg.sender != market && msg.sender != oracleSigner) revert Errors.NotOracle();
        if (windowEnd != 0) revert Errors.AlreadyResolved();
        if (_windowEnd <= windowStart) revert Errors.BadWindow();
        windowEnd = _windowEnd;
        metadata = _metadata;
        emit WindowConfirmed(_windowEnd, _metadata);
    }

    function submitResolution(
        ResolutionReceipt calldata receipt,
        bytes calldata signature
    ) external onlyOracle {
        if (receipt.handleId != handleId || receipt.windowStart != windowStart)
            revert Errors.BadWindow();
        if (receipt.windowEnd != 0 && windowEnd != 0 && receipt.windowEnd != windowEnd)
            revert Errors.BadWindow();
        // Resolution is only valid once the window has actually ended. Standalone
        // oracles that were never confirmed have no end to enforce.
        if (windowEnd != 0 && block.timestamp < windowEnd) revert Errors.TooEarly();
        if (signature.length != 65) revert Errors.BadSignatureLength();
        if (_status != WindowStatus.OPEN && _status != WindowStatus.FROZEN)
            revert Errors.WindowNotOpenOrFrozen();
        if (_resolution.resolvedAt != 0) revert Errors.AlreadyResolved();

        bytes32 digest = receipt.digest(chainId, address(this));
        (uint8 v, bytes32 r, bytes32 s) = splitSignature(signature);
        // EIP-2: reject the high-s half of the curve (malleable signatures).
        if (
            uint256(s) >
            0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
        ) revert Errors.InvalidSignature();
        if (ecrecover(digest, v, r, s) != oracleSigner)
            revert Errors.InvalidSignature();

        bytes32 hash = keccak256(abi.encode(receipt));
        _status = WindowStatus.RESOLVED;
        _resolution = Resolution(
            receipt.direction,
            receipt.indexClose,
            hash,
            receipt.resolvedAt
        );
        emit WindowResolved(
            handleId,
            windowStart,
            receipt.direction,
            receipt.indexClose,
            hash
        );
    }

    function voidWindow(string calldata reason) external onlyOracle {
        if (_status != WindowStatus.OPEN && _status != WindowStatus.FROZEN)
            revert Errors.WindowNotOpenOrFrozen();
        if (_resolution.resolvedAt != 0) revert Errors.AlreadyResolved();
        _status = WindowStatus.VOIDED;
        emit WindowVoided(handleId, windowStart, reason);
    }

    function windowStatus() external view returns (WindowStatus) {
        return _status;
    }

    function resolutionOf()
        external
        view
        returns (
            bool direction,
            uint256 indexClose,
            bytes32 resolutionHash,
            uint256 resolvedAt
        )
    {
        Resolution storage r = _resolution;
        return (r.direction, r.indexClose, r.resolutionHash, r.resolvedAt);
    }

    /// EIP-712 digest for a receipt (verification aid for the relayer/tests).
    function receiptDigest(
        ResolutionReceipt calldata receipt
    ) external view returns (bytes32) {
        return receipt.digest(chainId, address(this));
    }

    function splitSignature(
        bytes calldata signature
    ) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
    }
}
