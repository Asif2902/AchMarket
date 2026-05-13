// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {HybridOrderBook} from "./HybridOrderBook.sol";
import {IHybridMarket} from "./interfaces/IHybridMarket.sol";

/// @title MarketRouter
/// @notice Single public execution entrypoint for CLOB-first trades with optional LMSR fallback.
contract MarketRouter is Ownable, ReentrancyGuard {
    enum TradeSide {
        Buy,
        Sell
    }

    struct ExecutionResult {
        uint256 requestedSharesWad;
        uint256 filledSharesWad;
        uint256 orderBookSharesWad;
        uint256 lmsrSharesWad;
        uint256 costWei;
        uint256 proceedsWei;
        uint256 feeWei;
        bool usedOrderBook;
        bool usedLmsr;
        bool isPartial;
    }

    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 100;
    uint256 public constant MAX_HOPS_LIMIT = 128;

    HybridOrderBook public orderBook;
    address public feeRecipient;
    address public marketRegistrar;
    uint256 public orderBookTakerFeeBps;
    uint256 public lmsrTakerFeeBps;
    uint256 public chunkSizeWad;
    uint256 public maxTradeSharesWad;
    uint256 public defaultMaxHops;
    bool public clobPaused;

    mapping(address => bool) public allowedMarket;

    event OrderBookUpdated(address indexed orderBook);
    event FeeRecipientUpdated(address indexed feeRecipient);
    event MarketRegistrarUpdated(address indexed registrar);
    event MarketAllowed(address indexed market, bool allowed);
    event ClobPausedUpdated(bool paused);
    event FeesUpdated(uint256 orderBookTakerFeeBps, uint256 lmsrTakerFeeBps);
    event ExecutionConfigUpdated(uint256 chunkSizeWad, uint256 maxTradeSharesWad, uint256 defaultMaxHops);
    event OrderBookFallback(address indexed market, uint256 indexed outcome, TradeSide side, uint256 remainingSharesWad);
    event LmsrQuoteUsed(address indexed market, uint256 indexed outcome, TradeSide side, uint256 sharesWad, uint256 amountWei);
    event HybridTrade(
        address indexed trader,
        address indexed market,
        uint256 indexed outcome,
        TradeSide side,
        uint256 requestedSharesWad,
        uint256 filledSharesWad,
        uint256 orderBookSharesWad,
        uint256 lmsrSharesWad,
        uint256 costWei,
        uint256 proceedsWei,
        uint256 feeWei
    );

    constructor(
        address _owner,
        address _orderBook,
        address _feeRecipient,
        uint256 _chunkSizeWad,
        uint256 _maxTradeSharesWad,
        uint256 _defaultMaxHops
    ) Ownable(_owner) {
        require(_owner != address(0), "Router: zero owner");
        require(_orderBook != address(0), "Router: zero order book");
        require(_feeRecipient != address(0), "Router: zero fee recipient");
        require(_chunkSizeWad > 0, "Router: zero chunk");
        require(_maxTradeSharesWad >= _chunkSizeWad, "Router: invalid max trade");
        require(_defaultMaxHops > 0 && _defaultMaxHops <= MAX_HOPS_LIMIT, "Router: invalid max hops");

        orderBook = HybridOrderBook(_orderBook);
        feeRecipient = _feeRecipient;
        chunkSizeWad = _chunkSizeWad;
        maxTradeSharesWad = _maxTradeSharesWad;
        defaultMaxHops = _defaultMaxHops;
    }

    modifier onlyOwnerOrRegistrar() {
        require(msg.sender == owner() || msg.sender == marketRegistrar, "Router: not registrar");
        _;
    }

    function setOrderBook(address _orderBook) external onlyOwner {
        require(_orderBook != address(0), "Router: zero order book");
        orderBook = HybridOrderBook(_orderBook);
        emit OrderBookUpdated(_orderBook);
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "Router: zero fee recipient");
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(_feeRecipient);
    }

    function setMarketRegistrar(address registrar) external onlyOwner {
        marketRegistrar = registrar;
        emit MarketRegistrarUpdated(registrar);
    }

    function setAllowedMarket(address market, bool allowed) external onlyOwnerOrRegistrar {
        require(market != address(0), "Router: zero market");
        allowedMarket[market] = allowed;
        emit MarketAllowed(market, allowed);
    }

    function setClobPaused(bool paused) external onlyOwner {
        clobPaused = paused;
        emit ClobPausedUpdated(paused);
    }

    function setFees(uint256 _orderBookTakerFeeBps, uint256 _lmsrTakerFeeBps) external onlyOwner {
        require(_orderBookTakerFeeBps <= MAX_FEE_BPS, "Router: OB fee too high");
        require(_lmsrTakerFeeBps <= MAX_FEE_BPS, "Router: LMSR fee too high");
        orderBookTakerFeeBps = _orderBookTakerFeeBps;
        lmsrTakerFeeBps = _lmsrTakerFeeBps;
        emit FeesUpdated(_orderBookTakerFeeBps, _lmsrTakerFeeBps);
    }

    function setExecutionConfig(
        uint256 _chunkSizeWad,
        uint256 _maxTradeSharesWad,
        uint256 _defaultMaxHops
    ) external onlyOwner {
        require(_chunkSizeWad > 0, "Router: zero chunk");
        require(_maxTradeSharesWad >= _chunkSizeWad, "Router: invalid max trade");
        require(_defaultMaxHops > 0 && _defaultMaxHops <= MAX_HOPS_LIMIT, "Router: invalid max hops");
        chunkSizeWad = _chunkSizeWad;
        maxTradeSharesWad = _maxTradeSharesWad;
        defaultMaxHops = _defaultMaxHops;
        emit ExecutionConfigUpdated(_chunkSizeWad, _maxTradeSharesWad, _defaultMaxHops);
    }

    function buy(
        address market,
        uint256 outcome,
        uint256 sharesWad,
        uint256 minSharesOutWad,
        uint256 maxCostWei,
        uint256 maxHops,
        uint256 deadline
    ) external payable nonReentrant returns (ExecutionResult memory result) {
        _assertTradeInputs(market, sharesWad, deadline);
        require(maxCostWei > 0, "Router: zero max cost");
        require(minSharesOutWad <= sharesWad, "Router: invalid min shares");

        result.requestedSharesWad = sharesWad;
        uint256 remaining = sharesWad;
        uint256 feeAccrued;
        uint256 routerFeeAccrued;
        uint256 hopsLimit = maxHops == 0 ? defaultMaxHops : maxHops;

        if (!_isClobUnavailable()) {
            uint256 limitPriceWad = _maxAverageBuyPrice(maxCostWei, sharesWad);
            try orderBook.executeMarketOrder{value: msg.value}(
                market,
                outcome,
                uint8(HybridOrderBook.Side.Bid),
                sharesWad,
                limitPriceWad,
                msg.sender,
                hopsLimit
            ) returns (uint256 gotShares, uint256 paidWei, uint256 clobFeeWei) {
                if (gotShares > 0) {
                    result.filledSharesWad += gotShares;
                    result.orderBookSharesWad += gotShares;
                    result.costWei += paidWei + clobFeeWei;
                    feeAccrued += clobFeeWei;
                    remaining -= gotShares;
                    result.usedOrderBook = true;
                }
            } catch {
                emit OrderBookFallback(market, outcome, TradeSide.Buy, remaining);
            }
        }

        if (remaining > 0 && _isHybridLmsrMarket(market)) {
            (uint256 paidWei, uint256 takerFee) = _buyFromLmsr(market, outcome, remaining, maxCostWei, msg.value, result.costWei);
            result.filledSharesWad += remaining;
            result.lmsrSharesWad += remaining;
            result.costWei += paidWei + takerFee;
            feeAccrued += takerFee;
            routerFeeAccrued += takerFee;
            result.usedLmsr = true;
            emit LmsrQuoteUsed(market, outcome, TradeSide.Buy, remaining, paidWei);
            remaining = 0;
        }

        require(result.filledSharesWad >= minSharesOutWad, "Router: min shares");
        result.feeWei = feeAccrued;
        result.isPartial = result.filledSharesWad < sharesWad;
        _settleBuy(result.costWei, routerFeeAccrued);
        _emitTrade(msg.sender, market, outcome, TradeSide.Buy, result);
    }

    function sell(
        address market,
        uint256 outcome,
        uint256 sharesWad,
        uint256 minProceedsWei,
        uint256 maxHops,
        uint256 deadline
    ) external nonReentrant returns (ExecutionResult memory result) {
        _assertTradeInputs(market, sharesWad, deadline);

        result.requestedSharesWad = sharesWad;
        uint256 remaining = sharesWad;
        uint256 feeAccrued;
        uint256 routerFeeAccrued;
        uint256 routerProceedsWei;
        uint256 hopsLimit = maxHops == 0 ? defaultMaxHops : maxHops;

        if (!_isClobUnavailable()) {
            uint256 limitPriceWad = _minAverageSellPrice(minProceedsWei, sharesWad);
            try orderBook.executeMarketOrder(
                market,
                outcome,
                uint8(HybridOrderBook.Side.Ask),
                sharesWad,
                limitPriceWad,
                msg.sender,
                hopsLimit
            ) returns (uint256 gotShares, uint256 grossWei, uint256 clobFeeWei) {
                if (gotShares > 0) {
                    result.filledSharesWad += gotShares;
                    result.orderBookSharesWad += gotShares;
                    result.proceedsWei += grossWei - clobFeeWei;
                    feeAccrued += clobFeeWei;
                    remaining -= gotShares;
                    result.usedOrderBook = true;
                }
            } catch {
                emit OrderBookFallback(market, outcome, TradeSide.Sell, remaining);
            }
        }

        if (remaining > 0 && _isHybridLmsrMarket(market)) {
            (uint256 grossWei, uint256 takerFee) = _sellToLmsr(market, outcome, remaining, 0);
            result.filledSharesWad += remaining;
            result.lmsrSharesWad += remaining;
            result.proceedsWei += grossWei - takerFee;
            feeAccrued += takerFee;
            routerFeeAccrued += takerFee;
            routerProceedsWei += grossWei - takerFee;
            result.usedLmsr = true;
            emit LmsrQuoteUsed(market, outcome, TradeSide.Sell, remaining, grossWei);
            remaining = 0;
        }

        require(result.proceedsWei >= minProceedsWei, "Router: min proceeds");
        result.feeWei = feeAccrued;
        result.isPartial = result.filledSharesWad < sharesWad;
        _settleSell(routerProceedsWei, routerFeeAccrued);
        _emitTrade(msg.sender, market, outcome, TradeSide.Sell, result);
    }

    function previewTrade(
        address market,
        uint256 outcome,
        TradeSide side,
        uint256 sharesWad,
        uint256 maxHops
    ) public view returns (ExecutionResult memory result) {
        require(allowedMarket[market], "Router: market not allowed");
        require(sharesWad > 0, "Router: zero shares");
        require(sharesWad <= maxTradeSharesWad, "Router: trade too large");

        result.requestedSharesWad = sharesWad;
        uint256 remaining = sharesWad;
        uint256 lmsrPrice = _isHybridLmsrMarket(market) ? IHybridMarket(market).getImpliedProbability(outcome) : 0;

        if (!_isClobUnavailable()) {
            if (side == TradeSide.Buy) {
                (uint256 bookShares, uint256 notional) = orderBook.previewFill(
                    market,
                    outcome,
                    uint8(HybridOrderBook.Side.Ask),
                    _boundedBookPreviewShares(remaining, maxHops),
                    _isHybridLmsrMarket(market) ? lmsrPrice : WAD
                );
                uint256 takerFee = _fee(notional, orderBookTakerFeeBps);
                result.costWei += notional + takerFee;
                result.feeWei += takerFee;
                result.orderBookSharesWad += bookShares;
                result.filledSharesWad += bookShares;
                result.usedOrderBook = bookShares > 0;
                remaining -= bookShares;
            } else {
                (uint256 bookShares, uint256 gross) = orderBook.previewFill(
                    market,
                    outcome,
                    uint8(HybridOrderBook.Side.Bid),
                    _boundedBookPreviewShares(remaining, maxHops),
                    _isHybridLmsrMarket(market) ? lmsrPrice : 0
                );
                uint256 takerFee = _fee(gross, orderBookTakerFeeBps);
                result.proceedsWei += gross - takerFee;
                result.feeWei += takerFee;
                result.orderBookSharesWad += bookShares;
                result.filledSharesWad += bookShares;
                result.usedOrderBook = bookShares > 0;
                remaining -= bookShares;
            }
        }

        if (remaining > 0 && _isHybridLmsrMarket(market)) {
            if (side == TradeSide.Buy) {
                uint256 cost = IHybridMarket(market).previewBuy(outcome, remaining);
                uint256 takerFee = _fee(cost, lmsrTakerFeeBps);
                result.costWei += cost + takerFee;
                result.feeWei += takerFee;
            } else {
                uint256 gross = IHybridMarket(market).previewSell(outcome, remaining);
                uint256 takerFee = _fee(gross, lmsrTakerFeeBps);
                result.proceedsWei += gross - takerFee;
                result.feeWei += takerFee;
            }
            result.lmsrSharesWad += remaining;
            result.filledSharesWad += remaining;
            result.usedLmsr = true;
        }
        result.isPartial = result.filledSharesWad < sharesWad;
    }

    function getBestExecution(
        address market,
        uint256 outcome,
        TradeSide side,
        uint256 sharesWad,
        uint256 maxHops
    ) external view returns (ExecutionResult memory) {
        return previewTrade(market, outcome, side, sharesWad, maxHops);
    }

    function _buyFromLmsr(
        address market,
        uint256 outcome,
        uint256 sharesWad,
        uint256 maxCostWei,
        uint256 availableWei,
        uint256 spentSoFar
    ) internal returns (uint256 paidWei, uint256 takerFee) {
        paidWei = IHybridMarket(market).previewBuy(outcome, sharesWad);
        takerFee = _fee(paidWei, lmsrTakerFeeBps);
        require(spentSoFar + paidWei + takerFee <= maxCostWei, "Router: slippage");
        require(spentSoFar + paidWei + takerFee <= availableWei, "Router: insufficient value");
        uint256 actualCost = IHybridMarket(market).buyFor{value: paidWei}(msg.sender, outcome, sharesWad, paidWei);
        require(actualCost == paidWei, "Router: LMSR cost changed");
    }

    function _sellToLmsr(address market, uint256 outcome, uint256 sharesWad, uint256 minReceiveWei)
        internal
        returns (uint256 grossWei, uint256 takerFee)
    {
        grossWei = IHybridMarket(market).sellFrom(msg.sender, outcome, sharesWad, minReceiveWei, payable(address(this)));
        takerFee = _fee(grossWei, lmsrTakerFeeBps);
        require(grossWei >= takerFee, "Router: fee exceeds proceeds");
    }

    function _settleBuy(uint256 spentWei, uint256 feeWei) internal {
        if (feeWei > 0) _sendValue(payable(feeRecipient), feeWei, "Router: fee failed");
        uint256 refund = msg.value - spentWei;
        if (refund > 0) _sendValue(payable(msg.sender), refund, "Router: refund failed");
    }

    function _settleSell(uint256 proceedsWei, uint256 feeWei) internal {
        if (feeWei > 0) _sendValue(payable(feeRecipient), feeWei, "Router: fee failed");
        if (proceedsWei > 0) _sendValue(payable(msg.sender), proceedsWei, "Router: proceeds failed");
    }

    function _assertTradeInputs(address market, uint256 sharesWad, uint256 deadline) internal view {
        require(block.timestamp <= deadline, "Router: expired");
        require(allowedMarket[market], "Router: market not allowed");
        require(IHybridMarket(market).isTradingOpen(), "Router: trading closed");
        require(sharesWad > 0, "Router: zero shares");
        require(sharesWad <= maxTradeSharesWad, "Router: trade too large");
    }

    function _isClobUnavailable() internal view returns (bool) {
        return clobPaused || orderBook.paused();
    }

    function _isHybridLmsrMarket(address market) internal view returns (bool) {
        return IHybridMarket(market).marketMode() == 1;
    }

    function _maxAverageBuyPrice(uint256 maxCostWei, uint256 sharesWad) internal pure returns (uint256) {
        uint256 price = (maxCostWei * WAD) / sharesWad;
        return price > WAD ? WAD : price;
    }

    function _minAverageSellPrice(uint256 minProceedsWei, uint256 sharesWad) internal pure returns (uint256) {
        if (minProceedsWei == 0) return 1;
        uint256 price = (minProceedsWei * WAD) / sharesWad;
        return price > WAD ? WAD : price;
    }

    function _boundedBookPreviewShares(uint256 sharesWad, uint256 maxHops) internal view returns (uint256) {
        uint256 hops = maxHops == 0 ? defaultMaxHops : maxHops;
        uint256 hopCapacity = hops * chunkSizeWad;
        return hopCapacity < sharesWad ? hopCapacity : sharesWad;
    }

    function _spentWith(
        ExecutionResult memory result,
        uint256 notionalWei,
        uint256 feeBps
    ) internal pure returns (uint256) {
        return result.costWei + notionalWei + _fee(notionalWei, feeBps);
    }

    function _emitTrade(
        address trader,
        address market,
        uint256 outcome,
        TradeSide side,
        ExecutionResult memory result
    ) internal {
        emit HybridTrade(
            trader,
            market,
            outcome,
            side,
            result.requestedSharesWad,
            result.filledSharesWad,
            result.orderBookSharesWad,
            result.lmsrSharesWad,
            result.costWei,
            result.proceedsWei,
            result.feeWei
        );
    }

    function _mulWad(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b) / WAD;
    }

    function _fee(uint256 amount, uint256 feeBps) internal pure returns (uint256) {
        return (amount * feeBps) / MAX_BPS;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _sendValue(address payable to, uint256 amount, string memory errorMessage) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, errorMessage);
    }

    receive() external payable {}
}
