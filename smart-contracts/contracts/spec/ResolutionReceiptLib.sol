// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAuraOracle } from "./IAuraOracle.sol";

/// @title ResolutionReceiptLib
/// @notice EIP-712 helpers for the Aura oracle receipt. The digest produced
///         here must equal `eip712Digest()` in `packages/contracts/src/receipt.ts`.
library ResolutionReceiptLib {
    bytes32 internal constant EIP712DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant RESOLUTION_TYPEHASH = keccak256(
        "ResolutionReceipt(bytes32 handleId,uint256 windowStart,uint256 windowEnd,uint256 s,uint256 expectation,int256 delta,uint256 indexOpen,uint256 indexClose,bool direction,uint32 itemCount,bytes32 outcomesHash,uint256 resolvedAt,bytes32 inputsHash)"
    );

    function domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712DOMAIN_TYPEHASH,
                keccak256(bytes("Aura Oracle")),
                keccak256(bytes("1")),
                chainId,
                verifyingContract
            )
        );
    }

    function hashStruct(IAuraOracle.ResolutionReceipt memory receipt) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RESOLUTION_TYPEHASH,
                receipt.handleId, // bytes32 — encoded directly
                receipt.windowStart,
                receipt.windowEnd,
                receipt.s,
                receipt.expectation,
                receipt.delta,
                receipt.indexOpen,
                receipt.indexClose,
                receipt.direction,
                receipt.itemCount,
                receipt.outcomesHash,
                receipt.resolvedAt,
                receipt.inputsHash
            )
        );
    }

    /// The digest the oracle signs and the contract recovers via ecrecover.
    function digest(
        IAuraOracle.ResolutionReceipt memory receipt,
        uint256 chainId,
        address verifyingContract
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                bytes2(0x1901),
                domainSeparator(chainId, verifyingContract),
                hashStruct(receipt)
            )
        );
    }
}