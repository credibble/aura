// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockHandle
/// @notice Test double for `Handle.setGraduated`, so the GraduationConsumer's
///         loop is exercised without a full HandleFactory deployment.
contract MockHandle {
    bool public graduated;
    uint256 public calls;
    bool public shouldFail;

    function setShouldFail(bool v) external {
        shouldFail = v;
    }

    function setGraduated(bool ok) external {
        require(!shouldFail, "MockHandle: forced failure");
        graduated = ok;
        calls += 1;
    }
}
