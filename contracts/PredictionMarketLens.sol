// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PredictionMarket}        from "./PredictionMarket.sol";
import {PredictionMarketFactory} from "./PredictionMarketFactory.sol";

/// @title  PredictionMarketLens
/// @notice Read-only analytics contract that aggregates data from
///         PredictionMarketFactory and its child PredictionMarket contracts.
///
///         Separated from the Factory to keep both contracts under the
///         24 KB EIP-170 size limit.
///
///         All functions are `view` -- no state is modified.
///
contract PredictionMarketLens {

    /*//////////////////////////////////////////////////////////////
                              STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The factory this lens reads from.
    PredictionMarketFactory public immutable factory;

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _factory) {
        require(_factory != address(0), "Lens: zero factory");
        factory = PredictionMarketFactory(_factory);
    }

    /*//////////////////////////////////////////////////////////////
                       GLOBAL ANALYTICS  (VIEW)
    //////////////////////////////////////////////////////////////*/

    struct GlobalStats {
        uint256 totalMarkets;
        uint256 totalVolumeWei;
        uint256 totalParticipants;
        uint256 activeMarkets;
        uint256 resolvedMarkets;
        uint256 cancelledOrExpiredMarkets;
    }

    /// @notice Live global statistics -- aggregates all submarkets.
    /// @dev    O(n) loop; for very large registries combine with off-chain indexing.
    function getGlobalStats() external view returns (GlobalStats memory stats) {
        uint256 total = factory.totalMarkets();
        stats.totalMarkets = total;

        address[] memory mkts = factory.getMarkets(0, total);

        for (uint256 i = 0; i < mkts.length; ) {
            PredictionMarket pm = PredictionMarket(payable(mkts[i]));

            stats.totalVolumeWei    += pm.totalVolumeWei();
            stats.totalParticipants += pm.participantCount();

            PredictionMarket.Stage s = pm.stage();
            if      (s == PredictionMarket.Stage.Active)   stats.activeMarkets++;
            else if (s == PredictionMarket.Stage.Resolved) stats.resolvedMarkets++;
            else                                            stats.cancelledOrExpiredMarkets++;

            unchecked { i++; }
        }
    }

    /*//////////////////////////////////////////////////////////////
                  MARKET LIST -- PAGINATED  (VIEW)
    //////////////////////////////////////////////////////////////*/

    struct MarketSummary {
        address   market;
        uint256   marketId;
        // Metadata
        string    title;
        string    category;
        string    imageUri;
        // Outcomes
        string[]  outcomeLabels;
        int256[]  impliedProbabilitiesWad; // one per outcome, each 0-1e18
        // State
        PredictionMarket.Stage  stage;
        uint256   winningOutcome;
        uint256   marketDeadline;
        // Analytics
        uint256   totalVolumeWei;
        uint256   participants;
        // LMSR
        int256    bWad;
    }

    /// @notice Paginated market list with live LMSR probabilities.
    /// @param  offset  Start index.
    /// @param  limit   Max results per page.
    function getMarketSummaries(uint256 offset, uint256 limit)
        external
        view
        returns (MarketSummary[] memory summaries)
    {
        uint256 total = factory.totalMarkets();
        if (offset >= total) return new MarketSummary[](0);

        uint256 end   = offset + limit > total ? total : offset + limit;
        uint256 count = end - offset;

        address[] memory mkts = factory.getMarkets(offset, count);
        summaries = new MarketSummary[](count);

        for (uint256 i = 0; i < count; ) {
            address mAddr = mkts[i];
            PredictionMarket pm = PredictionMarket(payable(mAddr));

            (
                string memory _title,
                ,                           // description
                string memory _cat,
                string memory _img,
                ,                           // proofUri
                string[] memory _labels,
                PredictionMarket.Stage _stage,
                uint256 _winning,
                ,                           // createdAt
                uint256 _deadline,
                uint256 _vol,
                uint256 _part,
                ,                           // cancelReason
                                            // cancelProofUri
            ) = pm.getMarketInfo();

            summaries[i] = MarketSummary({
                market:                  mAddr,
                marketId:                offset + i,
                title:                   _title,
                category:                _cat,
                imageUri:                _img,
                outcomeLabels:           _labels,
                impliedProbabilitiesWad: pm.getImpliedProbabilities(),
                stage:                   _stage,
                winningOutcome:          _winning,
                marketDeadline:          _deadline,
                totalVolumeWei:          _vol,
                participants:            _part,
                bWad:                    pm.b()
            });

            unchecked { i++; }
        }
    }

    /*//////////////////////////////////////////////////////////////
                  MARKET DETAIL -- SINGLE MARKET  (VIEW)
    //////////////////////////////////////////////////////////////*/

    struct MarketDetail {
        address   market;
        // Metadata
        string    title;
        string    description;
        string    category;
        string    imageUri;
        string    proofUri;
        // Outcomes
        string[]  outcomeLabels;
        int256[]  totalSharesWad;
        int256[]  impliedProbabilitiesWad;
        // State
        PredictionMarket.Stage  stage;
        uint256   winningOutcome;
        uint256   createdAt;
        uint256   marketDeadline;
        int256    bWad;
        // Analytics
        uint256   totalVolumeWei;
        uint256   participants;
        // Resolution / Fee
        uint256   resolvedPoolWei;
        uint256   resolutionDeadline;
        // Cancel info
        string    cancelReason;
        string    cancelProofUri;
    }

    /// @notice Full detail for a single market.
    function getMarketDetail(address market)
        external
        view
        returns (MarketDetail memory d)
    {
        require(factory.isMarket(market), "Lens: unknown market");
        PredictionMarket pm = PredictionMarket(payable(market));

        (
            string memory _title,
            string memory _desc,
            string memory _cat,
            string memory _img,
            string memory _proof,
            string[] memory _labels,
            PredictionMarket.Stage _stage,
            uint256 _winning,
            uint256 _created,
            uint256 _deadline,
            uint256 _vol,
            uint256 _part,
            string memory _cancelReason,
            string memory _cancelProofUri
        ) = pm.getMarketInfo();

        d = MarketDetail({
            market:                   market,
            title:                    _title,
            description:              _desc,
            category:                 _cat,
            imageUri:                 _img,
            proofUri:                 _proof,
            outcomeLabels:            _labels,
            totalSharesWad:           pm.getShares(),
            impliedProbabilitiesWad:  pm.getImpliedProbabilities(),
            stage:                    _stage,
            winningOutcome:           _winning,
            createdAt:                _created,
            marketDeadline:           _deadline,
            bWad:                     pm.b(),
            totalVolumeWei:           _vol,
            participants:             _part,
            resolvedPoolWei:          pm.resolvedPoolWei(),
            resolutionDeadline:       pm.resolutionDeadline(),
            cancelReason:             _cancelReason,
            cancelProofUri:           _cancelProofUri
        });
    }

    /*//////////////////////////////////////////////////////////////
                  USER PORTFOLIO -- ALL POSITIONS  (VIEW)
    //////////////////////////////////////////////////////////////*/

    struct UserPosition {
        address   market;
        string    title;
        string    category;
        string[]  outcomeLabels;
        uint256[] sharesPerOutcome;  // WAD
        uint256   netDepositedWei;
        bool      canRedeem;
        bool      canRefund;
        bool      hasRedeemed;
        bool      hasRefunded;
        PredictionMarket.Stage stage;
    }

    /// @notice All active positions for a user across every market.
    /// @dev    Filters to markets where user holds shares or has a deposit.
    ///         For large registries combine with off-chain indexing.
    function getUserPortfolio(address user)
        external
        view
        returns (UserPosition[] memory positions)
    {
        uint256 total = factory.totalMarkets();
        address[] memory mkts = factory.getMarkets(0, total);

        // Count relevant markets first
        uint256 count;
        for (uint256 i = 0; i < mkts.length; ) {
            if (_userHasPosition(mkts[i], user)) count++;
            unchecked { i++; }
        }

        positions = new UserPosition[](count);
        uint256 idx;

        for (uint256 i = 0; i < mkts.length && idx < count; ) {
            address mAddr = mkts[i];
            if (!_userHasPosition(mAddr, user)) { unchecked { i++; } continue; }

            PredictionMarket pm = PredictionMarket(payable(mAddr));

            (
                uint256[] memory _shares,
                uint256          _deposited,
                bool             _redeemed,
                bool             _refunded,
                bool             _canRedeem,
                bool             _canRefund
            ) = pm.getUserInfo(user);

            (
                string memory _title,
                ,                           // description
                string memory _cat,
                ,                           // imageUri
                ,                           // proofUri
                string[] memory _labels,
                PredictionMarket.Stage _stage,
                ,                           // winningOutcome
                ,                           // createdAt
                ,                           // marketDeadline
                ,                           // totalVolumeWei
                ,                           // participantCount
                ,                           // cancelReason
                                            // cancelProofUri
            ) = pm.getMarketInfo();

            positions[idx++] = UserPosition({
                market:            mAddr,
                title:             _title,
                category:          _cat,
                outcomeLabels:     _labels,
                sharesPerOutcome:  _shares,
                netDepositedWei:   _deposited,
                canRedeem:         _canRedeem,
                canRefund:         _canRefund,
                hasRedeemed:       _redeemed,
                hasRefunded:       _refunded,
                stage:             _stage
            });

            unchecked { i++; }
        }
    }

    /*//////////////////////////////////////////////////////////////
                          INTERNAL HELPERS
    //////////////////////////////////////////////////////////////*/

    function _userHasPosition(address market, address user)
        internal view returns (bool)
    {
        PredictionMarket pm = PredictionMarket(payable(market));
        if (pm.netDepositedWei(user) > 0) return true;
        uint256 n = pm.outcomeCount();
        for (uint256 i = 0; i < n; ) {
            if (pm.sharesOf(user, i) > 0) return true;
            unchecked { i++; }
        }
        return false;
    }
}
