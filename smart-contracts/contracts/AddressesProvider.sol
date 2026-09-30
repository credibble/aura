// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IAddressesProvider } from "./interfaces/IAddressesProvider.sol";
import { Errors } from "./libraries/Errors.sol";

/// @title AddressesProvider
/// @notice Registry of all deployed Aura contracts. The owner (protocol
///         deployer) registers each address; consumers (the oracle relayer, the
///         subgraph, the frontend) read the canonical set here.
contract AddressesProvider is IAddressesProvider, Ownable2Step {
    address public usdc;
    address public auraToken;
    address public oracleFactory;
    address public handleFactory;
    address public marketMaker;
    address public orderBook;
    address public revenueSharing;
    address public pool;
    address public configurator;

    constructor() Ownable(msg.sender) {}

    function _requireNonZero(address addr) internal pure {
        if (addr == address(0)) revert Errors.ZeroAddress();
    }

    function setUsdc(address addr) external onlyOwner {
        _requireNonZero(addr);
        usdc = addr;
    }

    function setAuraToken(address addr) external onlyOwner {
        _requireNonZero(addr);
        auraToken = addr;
    }

    function setOracleFactory(address addr) external onlyOwner {
        _requireNonZero(addr);
        oracleFactory = addr;
    }

    function setHandleFactory(address addr) external onlyOwner {
        _requireNonZero(addr);
        handleFactory = addr;
    }

    function setMarketMaker(address addr) external onlyOwner {
        _requireNonZero(addr);
        marketMaker = addr;
    }

    function setOrderBook(address addr) external onlyOwner {
        _requireNonZero(addr);
        orderBook = addr;
    }

    function setRevenueSharing(address addr) external onlyOwner {
        _requireNonZero(addr);
        revenueSharing = addr;
    }

    function setPool(address addr) external onlyOwner {
        _requireNonZero(addr);
        pool = addr;
    }

    function setConfigurator(address addr) external onlyOwner {
        _requireNonZero(addr);
        configurator = addr;
    }
}