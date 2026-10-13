import { ethers } from "hardhat";
import { expect } from "chai";

/**
 * CRE consumer contracts — the on-chain trust boundary the KeystoneForwarder
 * writes to. These tests exercise the REAL delivery shape:
 *
 *   - `onReport(bytes,bytes)` (the only signature the forwarder calls),
 *   - ERC165 advertising IReceiver/IERC165 (the forwarder checks it first),
 *   - forwarder authentication (any other caller reverts),
 *   - `abi.decode` of the exact workflow payload,
 *   - the reward path's approve-then-`Stake.reward` (AURA pulled FROM the
 *     consumer), and the graduation path's `Handle.setGraduated(true)`.
 */

const FORWARDER = "0x1111111111111111111111111111111111111111";
const STRANGER = "0x2222222222222222222222222222222222222222";
const IERC165_ID = "0x01ffc9a7";
// keccak256("onReport(bytes,bytes)")[:4]
const IRECEIVER_ID = ethers.id("onReport(bytes,bytes)").slice(0, 10);

async function forwarderSigner() {
  await ethers.provider.send("hardhat_impersonateAccount", [FORWARDER]);
  await ethers.provider.send("hardhat_setBalance", [
    FORWARDER,
    "0x1000000000000000000",
  ]);
  return ethers.getSigner(FORWARDER);
}

describe("CRE consumers (KeystoneForwarder trust boundary)", () => {
  it("RewardConsumer: forwarder-gated, ERC165-correct, decodes the report and rewards", async () => {
    const [deployer, stranger] = await ethers.getSigners();

    const aura = await (await ethers.getContractFactory("AuraToken")).deploy();
    const consumer = await (
      await ethers.getContractFactory("RewardConsumer")
    ).deploy(FORWARDER, await aura.getAddress());
    const consumerAddr = await consumer.getAddress();

    // ERC165: the forwarder refuses delivery unless IReceiver is advertised.
    expect(await consumer.supportsInterface(IERC165_ID)).to.equal(true);
    expect(await consumer.supportsInterface(IRECEIVER_ID)).to.equal(true);
    expect(await consumer.getForwarderAddress()).to.equal(FORWARDER);

    // Fund the consumer with AURA (it is the source of every reward).
    const payout = ethers.parseUnits("1000", 18);
    await aura.mint(await consumer.getAddress(), payout * 10n);

    // Two stake vaults — the consumer must approve EACH before pulling.
    const stakeA = await (await ethers.getContractFactory("MockStake")).deploy(
      await aura.getAddress(),
    );
    const stakeB = await (await ethers.getContractFactory("MockStake")).deploy(
      await aura.getAddress(),
    );

    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]", "uint256"],
      [[await stakeA.getAddress(), await stakeB.getAddress()], payout],
    );

    // A stranger cannot deliver a report.
    await expect(
      consumer.connect(stranger).onReport("0x", report),
    ).to.be.revertedWithCustomError(consumer, "InvalidSender");

    // The forwarder can — and both vaults get funded.
    const fwd = await forwarderSigner();
    await expect(consumer.connect(fwd).onReport("0x00", report))
      .to.emit(consumer, "Rewarded")
      .withArgs(
        [await stakeA.getAddress(), await stakeB.getAddress()],
        payout,
        2n,
      );

    expect(await stakeA.totalRewarded()).to.equal(payout);
    expect(await stakeB.totalRewarded()).to.equal(payout);
    // Consumer spent exactly 2 × payout.
    expect(await aura.balanceOf(consumerAddr)).to.equal(payout * 8n);

    // Malformed payload fails closed (decode revert), never a silent no-op.
    await expect(
      consumer.connect(fwd).onReport("0x", "0xdeadbeef"),
    ).to.be.reverted;
  });

  it("GraduationConsumer: forwarder-gated, ERC165-correct, graduates every candidate", async () => {
    const [, stranger] = await ethers.getSigners();

    const consumer = await (
      await ethers.getContractFactory("GraduationConsumer")
    ).deploy(FORWARDER);

    expect(await consumer.supportsInterface(IERC165_ID)).to.equal(true);
    expect(await consumer.supportsInterface(IRECEIVER_ID)).to.equal(true);

    const handleA = await (await ethers.getContractFactory("MockHandle")).deploy();
    const handleB = await (await ethers.getContractFactory("MockHandle")).deploy();
    expect(await handleA.graduated()).to.equal(false);

    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]"],
      [[await handleA.getAddress(), await handleB.getAddress()]],
    );

    await expect(
      consumer.connect(stranger).onReport("0x", report),
    ).to.be.revertedWithCustomError(consumer, "InvalidSender");

    const fwd = await forwarderSigner();
    await expect(consumer.connect(fwd).onReport("0x00", report)).to.emit(
      consumer,
      "Graduated",
    );

    expect(await handleA.graduated()).to.equal(true);
    expect(await handleB.graduated()).to.equal(true);
    expect(await handleA.calls()).to.equal(1n);
  });

  it("GraduationConsumer: one unwired handle does not block the batch; all-fail reverts", async () => {
    const consumer = await (
      await ethers.getContractFactory("GraduationConsumer")
    ).deploy(FORWARDER);

    const good = await (await ethers.getContractFactory("MockHandle")).deploy();
    const bad = await (await ethers.getContractFactory("MockHandle")).deploy();
    await bad.setShouldFail(true);

    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]"],
      [[await good.getAddress(), await bad.getAddress()]],
    );

    const fwd = await forwarderSigner();
    await expect(consumer.connect(fwd).onReport("0x00", report))
      .to.emit(consumer, "Graduated")
      .and.to.emit(consumer, "GraduationFailed");

    expect(await good.graduated()).to.equal(true); // the good one still landed
    expect(await bad.graduated()).to.equal(false);

    // If EVERY candidate fails, the report reverts — a config error is surfaced.
    const reportAllBad = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]"],
      [[await bad.getAddress()]],
    );
    await expect(
      consumer.connect(fwd).onReport("0x00", reportAllBad),
    ).to.be.revertedWith("no handles graduated");
  });
});
