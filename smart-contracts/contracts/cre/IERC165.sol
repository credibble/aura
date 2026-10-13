// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title IERC165
/// @notice Standard ERC-165 interface detection (OpenZeppelin-compatible).
interface IERC165 {
    /// @notice Returns true if this contract implements the interface defined by `interfaceId`.
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
