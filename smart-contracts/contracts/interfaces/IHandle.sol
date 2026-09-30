// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * IHandle — the public surface of Handle.
 *
 * Declared once, where callers read it: the events the contract announces
 * first, then the external functions it accepts. Access control lives in the
 * implementation — an interface carries no modifiers — so the declarations
 * here are the ungated shape of each function, admin and protocol alike.
 */
interface IHandle {
    /// Every USDC routed here (the creator's fee share) is claimable — no
    /// per-role tracker; `claim()` pays out the entire balance to the creator.
    event Claimed(address indexed to, uint256 usdc);
    event MetadataSet(string metadata);
    event WindowMinutesSet(uint256 windowMinutes);
    event OracleFactorySet(address indexed oracleFactory);
    event RevenueSet(address indexed revenue);
    event StakeSet(address indexed stake);
    event SourcesChanged(string[] sources);
    event AuraUpdated(uint256 aura, string summary);
    event AuraUpdaterSet(address indexed updater);
    event CuratorSet(address indexed curator);
    event GraduatedSet(bool graduated);
    event CategoriesSet(uint256[] categories);
    event VerifiedSet(bool verified);

    function setMetadata(string calldata _metadata) external;

    function setWindowMinutes(uint256 _windowMinutes) external;

    function addSource(string calldata source) external;

    function removeSource(uint256 index) external;

    function sourcesCount() external view returns (uint256);

    function claim() external;

    function setAuraUpdater(address updater) external;

    function setGraduated(bool ok) external;

    function updateAura(uint256 _aura, string calldata summary) external;

    function setCurator(address _curator) external;

    function setCategories(uint256[] calldata _categories) external;

    function categoriesCount() external view returns (uint256);

    function hasCategory(uint256 code) external view returns (bool);

    function setVerified(bool ok) external;

    function setMarketByFactory(address _market) external;

    function setOracleFactory(address _oracleFactory) external;

    function setRevenue(address _revenue) external;

    function setStake(address _stake) external;
}
