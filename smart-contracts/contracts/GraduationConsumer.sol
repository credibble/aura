// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IHandle } from "./interfaces/IHandle.sol";
import { ReceiverTemplate } from "./cre/ReceiverTemplate.sol";

/// @title GraduationConsumer
/// @notice Receives CRE graduation reports and graduates handles that have
///         cleared the aura bar. The graduation workflow ABI-encodes
///         `(address[] handles)`, signs it into a CRE report, and the Keystone
///         Forwarder delivers it to `onReport`. This consumer calls
///         `Handle.setGraduated(true)` on each candidate.
///
/// @dev `Handle.setGraduated` is `onlyGraduator`, so this consumer must be the
///      handle's `graduator` (or its curator/aura-updater fallback). Run
///      `HandleFactory.setGraduator` per handle to grant it.
///
///      Batch resilience: a handle this consumer is not wired for (e.g. one
///      created after the last wiring pass) must not block graduating the rest,
///      so each candidate is tried independently and failures are recorded. If
///      NONE succeed the report reverts, so a fully-misconfigured deployment is
///      surfaced rather than silently succeeding.
///
///      Report trust boundary: the inherited ReceiverTemplate authenticates
///      `msg.sender == forwarder` and advertises IReceiver via ERC165.
contract GraduationConsumer is ReceiverTemplate {
    /// Emitted after a batch graduation, with the handles that did graduate.
    event Graduated(address[] handles, uint256 count);

    /// Emitted per candidate that could not be graduated (not wired / reverted).
    event GraduationFailed(address indexed handle, bytes reason);

    constructor(address _forwarder) ReceiverTemplate(_forwarder) {}

    /// @inheritdoc ReceiverTemplate
    /// @dev Payload ABI: `abi.encode(address[] handles)`.
    function _processReport(bytes calldata report) internal override {
        address[] memory handles = abi.decode(report, (address[]));
        if (handles.length == 0) revert("empty handles");

        address[] memory graduated = new address[](handles.length);
        uint256 okCount = 0;

        for (uint256 i = 0; i < handles.length; i++) {
            // Independent try: one unwired/bad handle must not block the batch.
            try IHandle(handles[i]).setGraduated(true) {
                graduated[okCount] = handles[i];
                okCount++;
            } catch (bytes memory reason) {
                emit GraduationFailed(handles[i], reason);
            }
        }

        // All-or-nothing only when EVERY candidate failed — a clear misconfig.
        if (okCount == 0) revert("no handles graduated");

        // Trim to the successful entries for the event.
        address[] memory done = new address[](okCount);
        for (uint256 i = 0; i < okCount; i++) done[i] = graduated[i];
        emit Graduated(done, okCount);
    }
}
