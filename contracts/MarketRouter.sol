// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {HybridOrderBook} from "./HybridOrderBook.sol";
import {IHybridMarket} from "./interfaces/IHybridMarket.sol";

/// @title MarketRouter
/// @notice Single public execution entrypoint that routes same-outcome trades across CLOB and bounded MM liquidity.
contract MarketRouter is Ownable, ReentrancyGuard {
    enum TradeSide {
        Buy,
        Sell
    }

    enum ExecutionSource {
        CLOB,
        MM,
        SPLIT
    }

    struct ExecutionResult {
        uint256 requestedSharesWad;
        uint256 filledSharesWad;
        uint256 orderBookSharesWad;
        uint256 mmSharesWad;
        uint256 costWei;
        uint256 proceedsWei;
        uint256 feeWei;
        bool usedOrderBook;
        bool usedMM;
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
    uint256 public mmTakerFeeBps;
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
    event FeesUpdated(uint256 orderBookTakerFeeBps, uint256 mmTakerFeeBps);
    event ExecutionConfigUpdated(uint256 chunkSizeWad, uint256 maxTradeSharesWad, uint256 defaultMaxHops);
    event OrderBookFallback(address indexed market, uint256 indexed outcome, TradeSide side, uint256 remainingSharesWad);
    event MmQuoteUsed(address indexed market, uint256 indexed outcome, TradeSide side, uint256 sharesWad, uint256 amountWei);
    event HybridTrade(
        address indexed trader,
        address indexed market,
        uint256 indexed outcome,
        TradeSide side,
        uint256 requestedSharesWad,
        uint256 filledSharesWad,
        uint256 orderBookSharesWad,
        uint256 mmSharesWad,
        uint256 costWei,
        uint256 proceedsWei,
        uint256 feeWei
    );
    event TradeExecuted(
        address indexed trader,
        address indexed market,
        uint256 indexed outcomeId,
        uint256 priceWad,
        uint256 amountWad,
        uint256 timestamp,
        ExecutionSource executionSource,
        TradeSide side,
        uint256 notionalWei,
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

    function lmsrTakerFeeBps() external view returns (uint256) {
        return mmTakerFeeBps;
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

    function setFees(uint256 _orderBookTakerFeeBps, uint256 _mmTakerFeeBps) external onlyOwner {
        require(_orderBookTakerFeeBps <= MAX_FEE_BPS, "Router: OB fee too high");
        require(_mmTakerFeeBps <= MAX_FEE_BPS, "Router: MM fee too high");
        orderBookTakerFeeBps = _orderBookTakerFeeBps;
        mmTakerFeeBps = _mmTakerFeeBps;
        emit FeesUpdated(_orderBookTakerFeeBps, _mmTakerFeeBps);
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
        uint256 routerFeeAccrued;
        uint256 hopsLimit = _hopsLimit(maxHops);
        uint256 hops;

        while (remaining > 0 && hops < hopsLimit) {
            (uint256 askPrice, uint256 askShares, uint256 askOrderId) = _bestAsk(market, outcome);
            (uint256 mmShares, uint256 mmCost, uint256 mmFee, uint256 mmPrice) =
                _nextMMBuyQuote(market, outcome, remaining);

            bool hasClob = askOrderId != 0 && askShares > 0;
            bool hasMM = mmShares > 0 && mmCost > 0;
            if (!hasClob && !hasMM) break;

            uint256 clobPrice = hasClob ? _withFee(askPrice, _clobFeeBps()) : type(uint256).max;
            if (hasClob && (!hasMM || clobPrice <= mmPrice)) {
                uint256 fillShares = _min(remaining, askShares);
                (uint256 gotShares, uint256 paidWei, uint256 feeWei) =
                    _buyFromClob(market, outcome, fillShares, askPrice);
                if (gotShares == 0) break;
                result.filledSharesWad += gotShares;
                result.orderBookSharesWad += gotShares;
                result.costWei += paidWei + feeWei;
                result.feeWei += feeWei;
                result.usedOrderBook = true;
                remaining -= gotShares;
            } else {
                require(result.costWei + mmCost + mmFee <= maxCostWei, "Router: slippage");
                require(result.costWei + mmCost + mmFee <= msg.value, "Router: insufficient value");
                uint256 paidWei = IHybridMarket(market).buyFor{value: mmCost}(msg.sender, outcome, mmShares, mmCost);
                require(paidWei == mmCost, "Router: MM cost changed");
                result.filledSharesWad += mmShares;
                result.mmSharesWad += mmShares;
                result.costWei += paidWei + mmFee;
                result.feeWei += mmFee;
                routerFeeAccrued += mmFee;
                result.usedMM = true;
                remaining -= mmShares;
                emit MmQuoteUsed(market, outcome, TradeSide.Buy, mmShares, paidWei);
            }
            require(result.costWei <= maxCostWei, "Router: slippage");
            require(result.costWei <= msg.value, "Router: insufficient value");
            unchecked { hops++; }
        }

        require(result.filledSharesWad > 0, "Router: no liquidity");
        require(result.filledSharesWad >= minSharesOutWad, "Router: min shares");
        result.isPartial = result.filledSharesWad < sharesWad;
        _settleBuy(result.costWei, routerFeeAccrued);
        _emitTrade(msg.sender, market, outcome, TradeSide.Buy, result);
    }

    function sell(
        address market,
        uint256 outcome,
        uint256 sharesWad,
        uint256 minSharesOutWad,
        uint256 minProceedsWei,
        uint256 maxHops,
        uint256 deadline
    ) external nonReentrant returns (ExecutionResult memory result) {
        _assertTradeInputs(market, sharesWad, deadline);
        require(minSharesOutWad <= sharesWad, "Router: invalid min shares");

        result.requestedSharesWad = sharesWad;
        uint256 remaining = sharesWad;
        uint256 routerFeeAccrued;
        uint256 routerProceedsWei;
        uint256 hopsLimit = _hopsLimit(maxHops);
        uint256 hops;

        while (remaining > 0 && hops < hopsLimit) {
            (uint256 bidPrice, uint256 bidShares, uint256 bidOrderId) = _bestBid(market, outcome);
            (uint256 mmShares, uint256 mmGross, uint256 mmFee, uint256 mmPrice) =
                _nextMMSellQuote(market, outcome, remaining);

            bool hasClob = bidOrderId != 0 && bidShares > 0;
            bool hasMM = mmShares > 0 && mmGross > 0;
            if (!hasClob && !hasMM) break;

            uint256 clobPrice = hasClob ? _lessFee(bidPrice, _clobFeeBps()) : 0;
            if (hasClob && (!hasMM || clobPrice >= mmPrice)) {
                uint256 fillShares = _min(remaining, bidShares);
                (uint256 gotShares, uint256 grossWei, uint256 feeWei) =
                    _sellToClob(market, outcome, fillShares, bidPrice);
                if (gotShares == 0) break;
                result.filledSharesWad += gotShares;
                result.orderBookSharesWad += gotShares;
                result.proceedsWei += grossWei - feeWei;
                result.feeWei += feeWei;
                result.usedOrderBook = true;
                remaining -= gotShares;
            } else {
                uint256 grossWei = IHybridMarket(market).sellFrom(
                    msg.sender,
                    outcome,
                    mmShares,
                    mmGross,
                    payable(address(this))
                );
                require(grossWei == mmGross, "Router: MM proceeds changed");
                require(grossWei >= mmFee, "Router: fee exceeds proceeds");
                result.filledSharesWad += mmShares;
                result.mmSharesWad += mmShares;
                result.proceedsWei += grossWei - mmFee;
                result.feeWei += mmFee;
                routerFeeAccrued += mmFee;
                routerProceedsWei += grossWei - mmFee;
                result.usedMM = true;
                remaining -= mmShares;
                emit MmQuoteUsed(market, outcome, TradeSide.Sell, mmShares, grossWei);
            }
            unchecked { hops++; }
        }

        require(result.filledSharesWad > 0, "Router: no liquidity");
        require(result.filledSharesWad >= minSharesOutWad, "Router: min shares");
        require(result.proceedsWei >= minProceedsWei, "Router: min proceeds");
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
        require(outcome < IHybridMarket(market).outcomeCount(), "Router: invalid outcome");

        return side == TradeSide.Buy
            ? _previewBuy(market, outcome, sharesWad, _hopsLimit(maxHops))
            : _previewSell(market, outcome, sharesWad, _hopsLimit(maxHops));
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

    function _buyFromClob(address market, uint256 outcome, uint256 sharesWad, uint256 limitPriceWad)
        internal
        returns (uint256 gotShares, uint256 paidWei, uint256 feeWei)
    {
        uint256 notional = _mulWad(sharesWad, limitPriceWad);
        uint256 maxPayment = notional + _fee(notional, _clobFeeBps());
        return orderBook.executeMarketOrder{value: maxPayment}(
            market,
            outcome,
            uint8(HybridOrderBook.Side.Bid),
            sharesWad,
            limitPriceWad,
            msg.sender,
            1
        );
    }

    function _sellToClob(address market, uint256 outcome, uint256 sharesWad, uint256 limitPriceWad)
        internal
        returns (uint256 gotShares, uint256 grossWei, uint256 feeWei)
    {
        return orderBook.executeMarketOrder(
            market,
            outcome,
            uint8(HybridOrderBook.Side.Ask),
            sharesWad,
            limitPriceWad,
            msg.sender,
            1
        );
    }

    function _nextMMBuyQuote(address market, uint256 outcome, uint256 remaining)
        internal
        view
        returns (uint256 sharesWad, uint256 costWei, uint256 feeWei, uint256 effectivePriceWad)
    {
        if (!_isHybridMMMarket(market)) return (0, 0, 0, 0);
        (, uint256 availableShares,,,,) = IHybridMarket(market).getMMOutcomeState(outcome);
        sharesWad = _min(_min(remaining, chunkSizeWad), availableShares);
        if (sharesWad == 0) return (0, 0, 0, 0);
        costWei = IHybridMarket(market).previewBuy(outcome, sharesWad);
        if (costWei == 0) return (0, 0, 0, 0);
        feeWei = _fee(costWei, mmTakerFeeBps);
        effectivePriceWad = ((costWei + feeWei) * WAD) / sharesWad;
    }

    function _nextMMSellQuote(address market, uint256 outcome, uint256 remaining)
        internal
        view
        returns (uint256 sharesWad, uint256 grossWei, uint256 feeWei, uint256 effectivePriceWad)
    {
        if (!_isHybridMMMarket(market)) return (0, 0, 0, 0);
        (,, uint256 soldShares,,,) = IHybridMarket(market).getMMOutcomeState(outcome);
        sharesWad = _min(_min(remaining, chunkSizeWad), soldShares);
        if (sharesWad == 0) return (0, 0, 0, 0);
        grossWei = IHybridMarket(market).previewSell(outcome, sharesWad);
        if (grossWei == 0) return (0, 0, 0, 0);
        feeWei = _fee(grossWei, mmTakerFeeBps);
        if (grossWei <= feeWei) return (0, 0, 0, 0);
        effectivePriceWad = ((grossWei - feeWei) * WAD) / sharesWad;
    }

    function _previewBuy(address market, uint256 outcome, uint256 sharesWad, uint256 hopsLimit)
        internal
        view
        returns (ExecutionResult memory result)
    {
        result.requestedSharesWad = sharesWad;
        uint256 remaining = sharesWad;
        (uint256[] memory askPrices, uint256[] memory askShares) = _depth(market, outcome, uint8(HybridOrderBook.Side.Ask), hopsLimit);
        (uint256 initialShares,, uint256 soldShares, uint256 reserveWei,,) = IHybridMarket(market).getMMOutcomeState(outcome);
        uint256 askIdx;
        uint256 askRemaining = askShares.length > 0 ? askShares[0] : 0;

        for (uint256 hops; remaining > 0 && hops < hopsLimit; ) {
            while (askIdx < askPrices.length && (askPrices[askIdx] == 0 || askRemaining == 0)) {
                askIdx++;
                askRemaining = askIdx < askShares.length ? askShares[askIdx] : 0;
            }
            bool hasClob = !_isClobUnavailable() && askIdx < askPrices.length && askPrices[askIdx] > 0 && askRemaining > 0;

            uint256 mmShares = 0;
            uint256 mmCost = 0;
            uint256 mmFee = 0;
            uint256 mmPrice = type(uint256).max;
            if (_isHybridMMMarket(market) && soldShares < initialShares) {
                mmShares = _min(_min(remaining, chunkSizeWad), initialShares - soldShares);
                mmCost = IHybridMarket(market).previewMMBuyFromState(outcome, soldShares, mmShares);
                if (mmCost > 0) {
                    mmFee = _fee(mmCost, mmTakerFeeBps);
                    mmPrice = ((mmCost + mmFee) * WAD) / mmShares;
                } else {
                    mmShares = 0;
                }
            }

            if (!hasClob && mmShares == 0) break;
            uint256 clobPrice = hasClob ? _withFee(askPrices[askIdx], _clobFeeBps()) : type(uint256).max;
            if (hasClob && (mmShares == 0 || clobPrice <= mmPrice)) {
                uint256 fill = _min(remaining, askRemaining);
                uint256 notional = _mulWad(fill, askPrices[askIdx]);
                uint256 fee = _fee(notional, _clobFeeBps());
                result.filledSharesWad += fill;
                result.orderBookSharesWad += fill;
                result.costWei += notional + fee;
                result.feeWei += fee;
                result.usedOrderBook = true;
                remaining -= fill;
                askRemaining -= fill;
            } else {
                result.filledSharesWad += mmShares;
                result.mmSharesWad += mmShares;
                result.costWei += mmCost + mmFee;
                result.feeWei += mmFee;
                result.usedMM = true;
                remaining -= mmShares;
                soldShares += mmShares;
                reserveWei += mmCost;
            }
            unchecked { hops++; }
        }
        reserveWei;
        result.isPartial = result.filledSharesWad < sharesWad;
    }

    function _previewSell(address market, uint256 outcome, uint256 sharesWad, uint256 hopsLimit)
        internal
        view
        returns (ExecutionResult memory result)
    {
        result.requestedSharesWad = sharesWad;
        uint256 remaining = sharesWad;
        (uint256[] memory bidPrices, uint256[] memory bidShares) = _depth(market, outcome, uint8(HybridOrderBook.Side.Bid), hopsLimit);
        (,, uint256 soldShares, uint256 reserveWei,,) = IHybridMarket(market).getMMOutcomeState(outcome);
        uint256 bidIdx;
        uint256 bidRemaining = bidShares.length > 0 ? bidShares[0] : 0;

        for (uint256 hops; remaining > 0 && hops < hopsLimit; ) {
            while (bidIdx < bidPrices.length && (bidPrices[bidIdx] == 0 || bidRemaining == 0)) {
                bidIdx++;
                bidRemaining = bidIdx < bidShares.length ? bidShares[bidIdx] : 0;
            }
            bool hasClob = !_isClobUnavailable() && bidIdx < bidPrices.length && bidPrices[bidIdx] > 0 && bidRemaining > 0;

            uint256 mmShares = 0;
            uint256 mmGross = 0;
            uint256 mmFee = 0;
            uint256 mmPrice = 0;
            if (_isHybridMMMarket(market) && soldShares > 0 && reserveWei > 0) {
                mmShares = _min(_min(remaining, chunkSizeWad), soldShares);
                mmGross = IHybridMarket(market).previewMMSellFromState(outcome, soldShares, reserveWei, mmShares);
                if (mmGross > 0) {
                    mmFee = _fee(mmGross, mmTakerFeeBps);
                    if (mmGross > mmFee) {
                        mmPrice = ((mmGross - mmFee) * WAD) / mmShares;
                    } else {
                        mmShares = 0;
                    }
                } else {
                    mmShares = 0;
                }
            }

            if (!hasClob && mmShares == 0) break;
            uint256 clobPrice = hasClob ? _lessFee(bidPrices[bidIdx], _clobFeeBps()) : 0;
            if (hasClob && (mmShares == 0 || clobPrice >= mmPrice)) {
                uint256 fill = _min(remaining, bidRemaining);
                uint256 gross = _mulWad(fill, bidPrices[bidIdx]);
                uint256 fee = _fee(gross, _clobFeeBps());
                result.filledSharesWad += fill;
                result.orderBookSharesWad += fill;
                result.proceedsWei += gross - fee;
                result.feeWei += fee;
                result.usedOrderBook = true;
                remaining -= fill;
                bidRemaining -= fill;
            } else {
                result.filledSharesWad += mmShares;
                result.mmSharesWad += mmShares;
                result.proceedsWei += mmGross - mmFee;
                result.feeWei += mmFee;
                result.usedMM = true;
                remaining -= mmShares;
                soldShares -= mmShares;
                reserveWei -= mmGross;
            }
            unchecked { hops++; }
        }
        result.isPartial = result.filledSharesWad < sharesWad;
    }

    function _depth(address market, uint256 outcome, uint8 side, uint256 maxLevels)
        internal
        view
        returns (uint256[] memory pricesWad, uint256[] memory sharesWad)
    {
        if (_isClobUnavailable()) return (new uint256[](0), new uint256[](0));
        return orderBook.getDepth(market, outcome, side, maxLevels);
    }

    function _bestAsk(address market, uint256 outcome)
        internal
        view
        returns (uint256 priceWad, uint256 sharesWad, uint256 orderId)
    {
        if (_isClobUnavailable()) return (0, 0, 0);
        return orderBook.getBestAsk(market, outcome);
    }

    function _bestBid(address market, uint256 outcome)
        internal
        view
        returns (uint256 priceWad, uint256 sharesWad, uint256 orderId)
    {
        if (_isClobUnavailable()) return (0, 0, 0);
        return orderBook.getBestBid(market, outcome);
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

    function _isHybridMMMarket(address market) internal view returns (bool) {
        return IHybridMarket(market).marketMode() == 1;
    }

    function _hopsLimit(uint256 maxHops) internal view returns (uint256) {
        uint256 hops = maxHops == 0 ? defaultMaxHops : maxHops;
        return hops > MAX_HOPS_LIMIT ? MAX_HOPS_LIMIT : hops;
    }

    function _clobFeeBps() internal view returns (uint256) {
        uint256 actual = orderBook.takerFeeBps();
        return actual > MAX_FEE_BPS ? orderBookTakerFeeBps : actual;
    }

    function _withFee(uint256 priceWad, uint256 feeBps) internal pure returns (uint256) {
        return (priceWad * (MAX_BPS + feeBps)) / MAX_BPS;
    }

    function _lessFee(uint256 priceWad, uint256 feeBps) internal pure returns (uint256) {
        return (priceWad * (MAX_BPS - feeBps)) / MAX_BPS;
    }

    function _emitTrade(
        address trader,
        address market,
        uint256 outcome,
        TradeSide side,
        ExecutionResult memory result
    ) internal {
        if (result.filledSharesWad > 0) {
            uint256 grossNotionalWei = side == TradeSide.Buy
                ? result.costWei - result.feeWei
                : result.proceedsWei + result.feeWei;
            uint256 avgPriceWad = (grossNotionalWei * WAD) / result.filledSharesWad;
            require(IHybridMarket(market).recordTradePrice(outcome, avgPriceWad), "Router: price record failed");
            ExecutionSource source = result.usedOrderBook && result.usedMM
                ? ExecutionSource.SPLIT
                : result.usedMM
                    ? ExecutionSource.MM
                    : ExecutionSource.CLOB;
            emit TradeExecuted(
                trader,
                market,
                outcome,
                avgPriceWad,
                result.filledSharesWad,
                block.timestamp,
                source,
                side,
                grossNotionalWei,
                result.feeWei
            );
        }

        emit HybridTrade(
            trader,
            market,
            outcome,
            side,
            result.requestedSharesWad,
            result.filledSharesWad,
            result.orderBookSharesWad,
            result.mmSharesWad,
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
