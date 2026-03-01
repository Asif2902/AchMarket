// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  LMSRMath
/// @notice Fixed-point math library (WAD = 1e18) implementing the
///         Logarithmic Market Scoring Rule for N outcomes.
///
///         Core formula:
///           C(q) = b * ln( Σ exp(q_i / b) )
///
///         Cost to buy Δ shares of outcome k:
///           cost = C(q_after) - C(q_before)
///
///         Selling is the same formula with a negative Δ (returns negative cost = ETH out).
///
/// @dev    exp/ln adapted from Solady FixedPointMathLib (MIT).
library LMSRMath {

    /*//////////////////////////////////////////////////////////////
                              CONSTANTS
    //////////////////////////////////////////////////////////////*/

    int256 internal constant WAD      = 1e18;
    int256 internal constant LN2_WAD  = 693147180559945309;

    /*//////////////////////////////////////////////////////////////
                         CORE LMSR  —  N OUTCOMES
    //////////////////////////////////////////////////////////////*/

    /// @notice Cost function C(q) for an arbitrary number of outcomes.
    /// @param  q  Array of total shares per outcome (WAD each).
    /// @param  b  Liquidity parameter (WAD). Larger b = less price impact.
    function costFunction(int256[] memory q, int256 b)
        internal pure returns (int256 cost)
    {
        int256 sumExp;
        for (uint256 i = 0; i < q.length; ) {
            sumExp += expWad((q[i] * WAD) / b);
            unchecked { i++; }
        }
        cost = (b * lnWad(sumExp)) / WAD;
    }

    /// @notice Cost (positive = pay in, negative = receive out) to change
    ///         outcome `idx` shares by `delta` (positive = buy, negative = sell).
    /// @param  q      Current shares array (WAD).
    /// @param  idx    Outcome index to trade.
    /// @param  delta  Share change in WAD. Positive = buy, negative = sell.
    /// @param  b      Liquidity parameter (WAD).
    /// @return deltaCost  ETH in WAD. Positive means user pays, negative means user receives.
    function tradeCost(
        int256[] memory q,
        uint256  idx,
        int256   delta,
        int256   b
    ) internal pure returns (int256 deltaCost) {
        int256 cOld = costFunction(q, b);

        int256[] memory qNew = _copy(q);
        qNew[idx] = q[idx] + delta;

        int256 cNew = costFunction(qNew, b);
        deltaCost = cNew - cOld;
    }

    /// @notice Implied probability of outcome `idx` (WAD, 0–1e18).
    ///         p_i = exp(q_i/b) / Σ exp(q_j/b)
    function impliedProbability(
        int256[] memory q,
        uint256  idx,
        int256   b
    ) internal pure returns (int256 prob) {
        int256 ei;
        int256 sumExp;
        for (uint256 i = 0; i < q.length; ) {
            int256 e = expWad((q[i] * WAD) / b);
            sumExp += e;
            if (i == idx) ei = e;
            unchecked { i++; }
        }
        prob = (ei * WAD) / sumExp;
    }

    /*//////////////////////////////////////////////////////////////
                          INTERNAL HELPERS
    //////////////////////////////////////////////////////////////*/

    function _copy(int256[] memory src)
        internal pure returns (int256[] memory dst)
    {
        dst = new int256[](src.length);
        for (uint256 i = 0; i < src.length; ) {
            dst[i] = src[i];
            unchecked { i++; }
        }
    }

    /*//////////////////////////////////////////////////////////////
                         FIXED-POINT  exp (WAD)
    //////////////////////////////////////////////////////////////*/

    /// @dev Returns e^x in WAD. Adapted from Solady (MIT).
    function expWad(int256 x) internal pure returns (int256 r) {
        unchecked {
            if (x <= -42139678854452767551) return 0;
            if (x >= 135305999368893231589) revert("LMSRMath: exp overflow");

            x = (x << 78) / 5 ** 18;

            int256 k = ((x << 96) / 54916777467707473351141471128 + 2 ** 95) >> 96;
            x = x - k * 54916777467707473351141471128;

            int256 y = x + 1346386616545796478920950773328;
            y = ((y * x) >> 96) + 57155421227552351082224309758442;
            int256 p = y + x - 94201549194550823612871063486197;
            p = ((p * y) >> 96) + 28719021644029726153956944680412240;
            p = p * x + (4385272521454847904659076985693276 << 96);

            int256 q2 = x - 2855989394907223263936484059900;
            q2 = ((q2 * x) >> 96) + 50020603652535783019951500526402;
            q2 = ((q2 * x) >> 96) - 533845033583426703283633433725386;
            q2 = ((q2 * x) >> 96) + 3604857256930695427073651918091429;
            q2 = ((q2 * x) >> 96) - 14423608567350463180887372962807573;
            q2 = ((q2 * x) >> 96) + 26449188498355588339325674977139648;

            assembly { r := sdiv(p, q2) }

            r = int256(
                (uint256(r) * 3822833074963236453042738258902158003155416615667)
                    >> uint256(195 - k)
            );
        }
    }

    /*//////////////////////////////////////////////////////////////
                         FIXED-POINT  ln (WAD)
    //////////////////////////////////////////////////////////////*/

    /// @dev Returns ln(x) in WAD. x must be positive. Adapted from Solady (MIT).
    function lnWad(int256 x) internal pure returns (int256 r) {
        unchecked {
            if (x <= 0) revert("LMSRMath: ln non-positive");

            uint256 ux = uint256(x);
            int256 msb;
            assembly {
                let t := or(ux, 1)
                msb := 255
                if gt(t, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { t := shr(128, t) msb := sub(msb, 128) }
                if gt(t, 0xFFFFFFFFFFFFFFFF)                 { t := shr(64,  t) msb := sub(msb, 64)  }
                if gt(t, 0xFFFFFFFF)                         { t := shr(32,  t) msb := sub(msb, 32)  }
                if gt(t, 0xFFFF)                             { t := shr(16,  t) msb := sub(msb, 16)  }
                if gt(t, 0xFF)                               { t := shr(8,   t) msb := sub(msb, 8)   }
                if gt(t, 0xF)                                { t := shr(4,   t) msb := sub(msb, 4)   }
                if gt(t, 0x3)                                { t := shr(2,   t) msb := sub(msb, 2)   }
                if gt(t, 0x1)                                {                  msb := sub(msb, 1)   }
                msb := sub(255, msb)
            }

            int256 xi = msb >= 0 ? x << uint256(msb) : x >> uint256(-msb);

            r = (xi - WAD) * 1e18;
            r = (r / (xi + WAD)) * 2;

            int256 z  = r;
            int256 z2 = (z * z) / WAD;
            r = z;
            z = (z * z2) / WAD; r += z / 3;
            z = (z * z2) / WAD; r += z / 5;
            z = (z * z2) / WAD; r += z / 7;
            z = (z * z2) / WAD; r += z / 9;
            z = (z * z2) / WAD; r += z / 11;

            r += msb * LN2_WAD;
        }
    }
}
