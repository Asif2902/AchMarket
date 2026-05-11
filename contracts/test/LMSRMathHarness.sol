// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LMSRMath} from "../LMSRMath.sol";

contract LMSRMathHarness {
    function costFunction(int256[] memory q, int256 b) external pure returns (int256) {
        return LMSRMath.costFunction(q, b);
    }

    function tradeCost(int256[] memory q, uint256 idx, int256 delta, int256 b) external pure returns (int256) {
        return LMSRMath.tradeCost(q, idx, delta, b);
    }

    function impliedProbability(int256[] memory q, uint256 idx, int256 b) external pure returns (int256) {
        return LMSRMath.impliedProbability(q, idx, b);
    }

    function initialLiquidity(uint256 outcomeCount, int256 b) external pure returns (int256) {
        return LMSRMath.initialLiquidity(outcomeCount, b);
    }
}
