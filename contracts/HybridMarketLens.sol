// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {HybridMarketFactory} from "./HybridMarketFactory.sol";
import {HybridOrderBook} from "./HybridOrderBook.sol";
import {MarketRouter} from "./MarketRouter.sol";
import {PredictionMarketV2} from "./PredictionMarketV2.sol";

/// @title HybridMarketLens
/// @notice Frontend-friendly read aggregation for the v2 hybrid market stack.
contract HybridMarketLens {
    HybridMarketFactory public immutable factory;
    MarketRouter public immutable router;
    HybridOrderBook public immutable orderBook;

    struct MarketSummary {
        address market;
        uint256 marketId;
        string title;
        string category;
        string imageUri;
        string[] outcomeLabels;
        int256[] impliedProbabilitiesWad;
        PredictionMarketV2.Stage stage;
        uint256 winningOutcome;
        uint256 marketDeadline;
        uint256 resolutionTime;
        uint256 totalVolumeWei;
        uint256 participants;
        int256 bWad;
    }

    struct MarketDetail {
        address market;
        string title;
        string description;
        string category;
        string imageUri;
        string proofUri;
        string[] outcomeLabels;
        int256[] totalSharesWad;
        int256[] impliedProbabilitiesWad;
        PredictionMarketV2.Stage stage;
        uint256 winningOutcome;
        uint256 createdAt;
        uint256 marketDeadline;
        uint256 resolutionTime;
        int256 bWad;
        uint256 totalVolumeWei;
        uint256 participants;
        uint256 resolvedPoolWei;
        string cancelReason;
        string cancelProofUri;
        string resolutionSource;
        string fallbackResolutionSource;
        string invalidCondition;
        address resolutionManager;
    }

    struct OrderBookSnapshot {
        uint256[] bestBidPriceWad;
        uint256[] bestBidSharesWad;
        uint256[] bestBidOrderId;
        uint256[] bestAskPriceWad;
        uint256[] bestAskSharesWad;
        uint256[] bestAskOrderId;
    }

    struct UserPosition {
        address market;
        string title;
        string category;
        string[] outcomeLabels;
        uint256[] sharesPerOutcome;
        bool canRedeem;
        bool hasRedeemed;
        PredictionMarketV2.Stage stage;
    }

    constructor(address _factory, address _router, address _orderBook) {
        require(_factory != address(0), "LensV2: zero factory");
        require(_router != address(0), "LensV2: zero router");
        require(_orderBook != address(0), "LensV2: zero order book");
        factory = HybridMarketFactory(payable(_factory));
        router = MarketRouter(payable(_router));
        orderBook = HybridOrderBook(_orderBook);
    }

    function getMarketSummaries(uint256 offset, uint256 limit)
        external
        view
        returns (MarketSummary[] memory summaries)
    {
        uint256 total = factory.totalMarkets();
        if (offset >= total) return new MarketSummary[](0);

        uint256 end = offset + limit > total ? total : offset + limit;
        uint256 count = end - offset;
        address[] memory mkts = factory.getMarkets(offset, count);
        summaries = new MarketSummary[](count);

        for (uint256 i = 0; i < count; ) {
            PredictionMarketV2 pm = PredictionMarketV2(payable(mkts[i]));
            (
                string memory title,
                ,
                string memory category,
                string memory imageUri,
                ,
                string[] memory labels,
                PredictionMarketV2.Stage stage,
                uint256 winningOutcome,
                ,
                uint256 deadline,
                uint256 volume,
                uint256 participants,
                ,
            ) = pm.getMarketInfo();

            summaries[i] = MarketSummary({
                market: mkts[i],
                marketId: offset + i,
                title: title,
                category: category,
                imageUri: imageUri,
                outcomeLabels: labels,
                impliedProbabilitiesWad: pm.getImpliedProbabilities(),
                stage: stage,
                winningOutcome: winningOutcome,
                marketDeadline: deadline,
                resolutionTime: pm.resolutionTime(),
                totalVolumeWei: volume,
                participants: participants,
                bWad: pm.b()
            });

            unchecked { i++; }
        }
    }

    function getMarketDetail(address market)
        external
        view
        returns (MarketDetail memory detail)
    {
        require(factory.isMarket(market), "LensV2: unknown market");
        PredictionMarketV2 pm = PredictionMarketV2(payable(market));

        (
            string memory title,
            string memory description,
            string memory category,
            string memory imageUri,
            string memory proofUri,
            string[] memory labels,
            PredictionMarketV2.Stage stage,
            uint256 winningOutcome,
            uint256 createdAt,
            uint256 deadline,
            uint256 volume,
            uint256 participants,
            string memory cancelReason,
            string memory cancelProofUri
        ) = pm.getMarketInfo();

        (
            string memory resolutionSource,
            uint256 resolutionTime,
            string memory fallbackResolutionSource,
            string memory invalidCondition,
            address resolutionManager
        ) = pm.getResolutionRules();

        detail = MarketDetail({
            market: market,
            title: title,
            description: description,
            category: category,
            imageUri: imageUri,
            proofUri: proofUri,
            outcomeLabels: labels,
            totalSharesWad: pm.getShares(),
            impliedProbabilitiesWad: pm.getImpliedProbabilities(),
            stage: stage,
            winningOutcome: winningOutcome,
            createdAt: createdAt,
            marketDeadline: deadline,
            resolutionTime: resolutionTime,
            bWad: pm.b(),
            totalVolumeWei: volume,
            participants: participants,
            resolvedPoolWei: pm.resolvedPoolWei(),
            cancelReason: cancelReason,
            cancelProofUri: cancelProofUri,
            resolutionSource: resolutionSource,
            fallbackResolutionSource: fallbackResolutionSource,
            invalidCondition: invalidCondition,
            resolutionManager: resolutionManager
        });
    }

    function getOrderBookSnapshot(address market)
        external
        view
        returns (OrderBookSnapshot memory snapshot)
    {
        require(factory.isMarket(market), "LensV2: unknown market");
        uint256 outcomes = PredictionMarketV2(payable(market)).outcomeCount();
        snapshot.bestBidPriceWad = new uint256[](outcomes);
        snapshot.bestBidSharesWad = new uint256[](outcomes);
        snapshot.bestBidOrderId = new uint256[](outcomes);
        snapshot.bestAskPriceWad = new uint256[](outcomes);
        snapshot.bestAskSharesWad = new uint256[](outcomes);
        snapshot.bestAskOrderId = new uint256[](outcomes);

        for (uint256 i = 0; i < outcomes; ) {
            (
                snapshot.bestBidPriceWad[i],
                snapshot.bestBidSharesWad[i],
                snapshot.bestBidOrderId[i]
            ) = orderBook.getBestBid(market, i);
            (
                snapshot.bestAskPriceWad[i],
                snapshot.bestAskSharesWad[i],
                snapshot.bestAskOrderId[i]
            ) = orderBook.getBestAsk(market, i);
            unchecked { i++; }
        }
    }

    function getUserPortfolio(address user) external view returns (UserPosition[] memory positions) {
        uint256 total = factory.totalMarkets();
        address[] memory mkts = factory.getMarkets(0, total);

        uint256 count;
        for (uint256 i = 0; i < mkts.length; ) {
            if (_userHasPosition(mkts[i], user)) count++;
            unchecked { i++; }
        }

        positions = new UserPosition[](count);
        uint256 idx;
        for (uint256 i = 0; i < mkts.length && idx < count; ) {
            if (!_userHasPosition(mkts[i], user)) {
                unchecked { i++; }
                continue;
            }

            PredictionMarketV2 pm = PredictionMarketV2(payable(mkts[i]));
            (
                uint256[] memory shares,
                bool redeemed,
                bool canRedeem
            ) = pm.getUserInfo(user);
            (
                string memory title,
                ,
                string memory category,
                ,
                ,
                string[] memory labels,
                PredictionMarketV2.Stage stage,
                ,
                ,
                ,
                ,
                ,
                ,
            ) = pm.getMarketInfo();

            positions[idx++] = UserPosition({
                market: mkts[i],
                title: title,
                category: category,
                outcomeLabels: labels,
                sharesPerOutcome: shares,
                canRedeem: canRedeem,
                hasRedeemed: redeemed,
                stage: stage
            });
            unchecked { i++; }
        }
    }

    function _userHasPosition(address market, address user) internal view returns (bool) {
        PredictionMarketV2 pm = PredictionMarketV2(payable(market));
        uint256 n = pm.outcomeCount();
        for (uint256 i = 0; i < n; ) {
            if (pm.sharesOf(user, i) > 0) return true;
            unchecked { i++; }
        }
        return false;
    }
}
