// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IStake } from "./interfaces/IStake.sol";
import { ReceiverTemplate } from "./cre/ReceiverTemplate.sol";

/// @title RewardConsumer
/// @notice Receives CRE stake-reward reports and tops up underfunded Stake
///         vaults. The stake-reward workflow ABI-encodes `(address[] stakes,
///         uint256 amount)`, signs it into a CRE report, and the Keystone
///         Forwarder delivers it to `onReport`. This consumer calls
///         `Stake.reward(amount, "CRE reward")` on each vault.
///
/// @dev `Stake.reward` does `aura.safeTransferFrom(msg.sender, stake, amount)`,
///      so THIS consumer is the AURA source: it must (a) hold AURA and (b)
///      approve each vault before calling `reward`. Both are done here — the
///      consumer force-approves each vault inline, so there is no per-vault
///      setup to run off-chain.
///
///      Report trust boundary: the inherited ReceiverTemplate authenticates
///      `msg.sender == forwarder` and advertises IReceiver via ERC165.
contract RewardConsumer is ReceiverTemplate {
    using SafeERC20 for IERC20;

    /// The AURA token this consumer distributes.
    IERC20 public immutable aura;

    /// Memo carried into each `Stake.reward` call (indexed on-chain).
    string public constant MEMO = "CRE reward";

    /// Emitted after a successful batch reward.
    event Rewarded(address[] stakes, uint256 amount, uint256 count);

    constructor(address _forwarder, IERC20 _aura) ReceiverTemplate(_forwarder) {
        aura = _aura;
    }

    /// @inheritdoc ReceiverTemplate
    /// @dev Payload ABI: `abi.encode(address[] stakes, uint256 amount)`.
    function _processReport(bytes calldata report) internal override {
        (address[] memory stakes, uint256 amount) = abi.decode(
            report,
            (address[], uint256)
        );
        if (stakes.length == 0) revert("empty stakes");
        if (amount == 0) revert("zero amount");

        for (uint256 i = 0; i < stakes.length; i++) {
            // The vault pulls AURA from this consumer, so approve it first.
            aura.forceApprove(stakes[i], amount);
            IStake(stakes[i]).reward(amount, MEMO);
        }

        emit Rewarded(stakes, amount, stakes.length);
    }

    /// @notice Sweep AURA back to a treasury (emergency / migration). Owner-only.
    function sweepAURA(address to, uint256 amount) external onlyOwner {
        aura.safeTransfer(to, amount);
    }
}
