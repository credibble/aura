// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Constants } from "./Constants.sol";

/// @title MathLib
/// @notice Minimal fixed-point math primitives used by the MarketMaker's LMSR
///         pricing (log-sum-exp): natural log and exp at 1e18. The old
///         Black-Scholes/SVI digital pricing that lived here was removed with
///         the IndexMarket — the market now trades outcome probabilities
///         (LMSR), not option prices.
library MathLib {
    /// Natural log in 1e18 given x in 1e18 (returns int256, may be negative).
    function ln(uint256 x18) internal pure returns (int256) {
        if (x18 == 0) return int256(0);
        // Normalize x into [1, 2) tracking the exponent.
        int256 e = 0;
        uint256 n = x18;
        while (n >= 2 * Constants.ONE) {
            n >>= 1;
            e += 1;
        }
        while (n < Constants.ONE) {
            n <<= 1;
            e -= 1;
        }
        // ln(m) = 2 * sum_k v^(2k+1)/(2k+1), v = (m-1)/(m+1), |v| <= 1/3.
        uint256 v = (n - Constants.ONE) * Constants.ONE / (n + Constants.ONE);
        uint256 v2 = v * v / Constants.ONE;
        uint256 term = v;
        uint256 sum = v;
        for (uint256 i = 1; i <= 24; i++) {
            term = term * v2 / Constants.ONE;
            sum += term / (2 * i + 1);
        }
        return 2 * int256(sum) + e * int256(Constants.LN2);
    }

    /// e^x in 1e18 for x >= 0 (x in 1e18).
    function exp(uint256 x18) internal pure returns (uint256) {
        // e^x = 2^(x*log2e)
        uint256 v = x18 * Constants.LOG2E / Constants.ONE;
        uint256 intPart = v / Constants.ONE;
        uint256 frac = v - intPart * Constants.ONE;
        // 2^frac = e^(frac*ln2)
        uint256 t = frac * Constants.LN2 / Constants.ONE;
        uint256 term = Constants.ONE;
        uint256 sum = Constants.ONE;
        for (uint256 i = 1; i <= 22; i++) {
            term = term * t / Constants.ONE / i;
            sum += term;
        }
        return sum << intPart;
    }
}