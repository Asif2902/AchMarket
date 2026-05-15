// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IHybridMarket} from "./interfaces/IHybridMarket.sol";

/// @title HybridOrderBook
/// @notice Fully on-chain FIFO CLOB for v2 prediction market shares.
contract HybridOrderBook is Ownable, ReentrancyGuard {
    enum Side {
        Bid,
        Ask
    }

    enum ExecutionSource {
        CLOB,
        MM,
        SPLIT
    }

    enum OrderStatus {
        Open,
        PartiallyFilled,
        Filled,
        Cancelled
    }

    struct Order {
        uint256 id;
        address market;
        uint256 outcome;
        address owner;
        Side side;
        uint256 priceWad;
        uint256 remainingSharesWad;
        uint256 escrowWei;
        uint256 expiry;
        bool active;
        uint256 originalSharesWad;
        OrderStatus status;
    }

    struct OrderQueue {
        uint256[] orderIds;
        uint256 head;
        uint256 totalSharesWad;
    }

    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant MAX_PRICE_LEVELS = 1_000;
    uint256 public constant MAX_FEE_BPS = 100;

    uint256 public nextOrderId = 1;
    address public router;
    address public feeRecipient;
    address public marketRegistrar;
    uint256 public tickSizeWad;
    uint256 public minOrderSharesWad;
    uint256 public maxPriceDeviationBps;
    uint256 public makerFeeBps;
    uint256 public takerFeeBps;
    uint256 public maxMatchesPerOrder = 32;
    bool public paused;

    mapping(address => bool) public allowedMarket;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) private _ownerOrderIds;
    mapping(bytes32 => OrderQueue) private _queues;

    event RouterUpdated(address indexed router);
    event FeeRecipientUpdated(address indexed feeRecipient);
    event MarketRegistrarUpdated(address indexed registrar);
    event MarketAllowed(address indexed market, bool allowed);
    event PausedUpdated(bool paused);
    event MakerFeeUpdated(uint256 makerFeeBps);
    event TakerFeeUpdated(uint256 takerFeeBps);
    event MaxMatchesPerOrderUpdated(uint256 maxMatchesPerOrder);
    event OrderConstraintsUpdated(uint256 tickSizeWad, uint256 minOrderSharesWad, uint256 maxPriceDeviationBps);
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed market,
        address indexed owner,
        uint256 outcome,
        Side side,
        uint256 priceWad,
        uint256 sharesWad,
        uint256 expiry
    );
    event OrderCancelled(uint256 indexed orderId, address indexed owner, uint256 remainingSharesWad, uint256 refundWei);
    event OrderPruned(uint256 indexed orderId, address indexed market, uint256 indexed outcome, Side side, uint256 priceWad);
    event OrderMatched(
        uint256 indexed orderId,
        address indexed market,
        address indexed taker,
        uint256 outcome,
        Side restingSide,
        uint256 priceWad,
        uint256 sharesWad,
        uint256 notionalWei,
        uint256 feeWei
    );
    event OrderPartiallyFilled(uint256 indexed orderId, uint256 remainingSharesWad);
    event TradeExecuted(
        address indexed trader,
        address indexed market,
        uint256 indexed outcomeId,
        uint256 priceWad,
        uint256 amountWad,
        uint256 timestamp,
        ExecutionSource executionSource,
        Side side,
        uint256 notionalWei,
        uint256 feeWei
    );
    event OrderFilled(
        uint256 indexed orderId,
        address indexed market,
        address indexed taker,
        uint256 outcome,
        Side side,
        uint256 sharesWad,
        uint256 notionalWei,
        uint256 makerFeeWei
    );

    modifier onlyRouter() {
        require(msg.sender == router, "OB: not router");
        _;
    }

    modifier onlyOwnerOrRegistrar() {
        require(msg.sender == owner() || msg.sender == marketRegistrar, "OB: not registrar");
        _;
    }

    constructor(
        address _owner,
        address _feeRecipient,
        uint256 _tickSizeWad,
        uint256 _minOrderSharesWad,
        uint256 _maxPriceDeviationBps
    ) Ownable(_owner) {
        require(_owner != address(0), "OB: zero owner");
        require(_feeRecipient != address(0), "OB: zero fee recipient");
        _setConstraints(_tickSizeWad, _minOrderSharesWad, _maxPriceDeviationBps);
        feeRecipient = _feeRecipient;
    }

    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "OB: zero router");
        router = _router;
        emit RouterUpdated(_router);
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "OB: zero fee recipient");
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(_feeRecipient);
    }

    function setMarketRegistrar(address registrar) external onlyOwner {
        marketRegistrar = registrar;
        emit MarketRegistrarUpdated(registrar);
    }

    function setAllowedMarket(address market, bool allowed) external onlyOwnerOrRegistrar {
        require(market != address(0), "OB: zero market");
        allowedMarket[market] = allowed;
        emit MarketAllowed(market, allowed);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedUpdated(_paused);
    }

    function setMakerFeeBps(uint256 _makerFeeBps) external onlyOwner {
        require(_makerFeeBps <= MAX_FEE_BPS, "OB: maker fee too high");
        makerFeeBps = _makerFeeBps;
        emit MakerFeeUpdated(_makerFeeBps);
    }

    function setTakerFeeBps(uint256 _takerFeeBps) external onlyOwner {
        require(_takerFeeBps <= MAX_FEE_BPS, "OB: taker fee too high");
        takerFeeBps = _takerFeeBps;
        emit TakerFeeUpdated(_takerFeeBps);
    }

    function setMaxMatchesPerOrder(uint256 _maxMatchesPerOrder) external onlyOwner {
        require(_maxMatchesPerOrder > 0 && _maxMatchesPerOrder <= 128, "OB: invalid matches");
        maxMatchesPerOrder = _maxMatchesPerOrder;
        emit MaxMatchesPerOrderUpdated(_maxMatchesPerOrder);
    }

    function setOrderConstraints(
        uint256 _tickSizeWad,
        uint256 _minOrderSharesWad,
        uint256 _maxPriceDeviationBps
    ) external onlyOwner {
        _setConstraints(_tickSizeWad, _minOrderSharesWad, _maxPriceDeviationBps);
        emit OrderConstraintsUpdated(_tickSizeWad, _minOrderSharesWad, _maxPriceDeviationBps);
    }

    function placeLimitOrder(
        address market,
        uint256 outcome,
        uint8 sideRaw,
        uint256 priceWad,
        uint256 sharesWad,
        uint256 expiry
    ) external payable nonReentrant returns (uint256 orderId) {
        require(!paused, "OB: paused");
        require(allowedMarket[market], "OB: market not allowed");
        require(IHybridMarket(market).isTradingOpen(), "OB: trading closed");
        require(outcome < IHybridMarket(market).outcomeCount(), "OB: invalid outcome");
        require(sideRaw <= uint8(Side.Ask), "OB: invalid side");
        require(sharesWad >= minOrderSharesWad, "OB: order too small");
        require(expiry == 0 || expiry > block.timestamp, "OB: expired order");
        _assertValidPrice(priceWad);

        Side side = Side(sideRaw);
        uint256 remainingSharesWad = sharesWad;
        uint256 availableWei = msg.value;
        uint256 matchedNotionalWei;
        uint256 takerFeeWei;

        if (side == Side.Bid) {
            uint256 maxNotionalWei = _mulWad(sharesWad, priceWad);
            require(msg.value >= maxNotionalWei + _fee(maxNotionalWei, takerFeeBps), "OB: insufficient escrow");
            (
                remainingSharesWad,
                availableWei,
                matchedNotionalWei,
                takerFeeWei
            ) = _matchIncomingBid(market, outcome, msg.sender, priceWad, sharesWad, availableWei, maxMatchesPerOrder);
        } else {
            require(msg.value == 0, "OB: ask cannot include value");
            require(
                IHybridMarket(market).moveShares(msg.sender, address(this), outcome, sharesWad),
                "OB: share escrow failed"
            );
            (
                remainingSharesWad,
                matchedNotionalWei,
                takerFeeWei
            ) = _matchIncomingAsk(market, outcome, msg.sender, priceWad, sharesWad, maxMatchesPerOrder);
        }

        if (remainingSharesWad > 0) {
            uint256 escrowWei;
            if (side == Side.Bid) {
                escrowWei = _mulWad(remainingSharesWad, priceWad);
                require(availableWei >= escrowWei, "OB: insufficient resting escrow");
                availableWei -= escrowWei;
            }

            orderId = _storeOrder(market, outcome, msg.sender, side, priceWad, remainingSharesWad, escrowWei, expiry);
        }

        if (availableWei > 0) _sendValue(payable(msg.sender), availableWei, "OB: refund failed");
        if (matchedNotionalWei > 0) {
            _emitTradeExecuted(
                msg.sender,
                market,
                outcome,
                side,
                sharesWad - remainingSharesWad,
                matchedNotionalWei,
                takerFeeWei
            );
        }
    }

    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.active, "OB: inactive order");
        require(order.owner == msg.sender, "OB: not owner");

        uint256 remaining = order.remainingSharesWad;
        uint256 refundWei = order.escrowWei;

        order.active = false;
        order.remainingSharesWad = 0;
        order.escrowWei = 0;
        order.status = OrderStatus.Cancelled;
        _decreaseLevel(order.market, order.outcome, order.side, order.priceWad, remaining);

        if (order.side == Side.Bid) {
            if (refundWei > 0) _sendValue(payable(order.owner), refundWei, "OB: escrow refund failed");
        } else if (remaining > 0) {
            require(
                IHybridMarket(order.market).moveShares(address(this), order.owner, order.outcome, remaining),
                "OB: share return failed"
            );
        }

        emit OrderCancelled(orderId, order.owner, remaining, refundWei);
    }

    function executeMarketOrder(
        address market,
        uint256 outcome,
        uint8 sideRaw,
        uint256 sharesWad,
        uint256 limitPriceWad,
        address trader,
        uint256 maxMatches
    )
        external
        payable
        nonReentrant
        onlyRouter
        returns (uint256 sharesFilledWad, uint256 notionalWei, uint256 feeWei)
    {
        require(!paused, "OB: paused");
        require(allowedMarket[market], "OB: market not allowed");
        require(IHybridMarket(market).isTradingOpen(), "OB: trading closed");
        require(outcome < IHybridMarket(market).outcomeCount(), "OB: invalid outcome");
        require(sideRaw <= uint8(Side.Ask), "OB: invalid side");
        require(sharesWad > 0, "OB: zero shares");
        require(trader != address(0), "OB: zero trader");
        _assertValidPrice(limitPriceWad);

        uint256 matches = maxMatches == 0 || maxMatches > maxMatchesPerOrder ? maxMatchesPerOrder : maxMatches;
        Side side = Side(sideRaw);

        if (side == Side.Bid) {
            uint256 remainingWei;
            uint256 remainingSharesWad;
            (remainingSharesWad, remainingWei, notionalWei, feeWei) =
                _matchIncomingBid(market, outcome, trader, limitPriceWad, sharesWad, msg.value, matches);
            sharesFilledWad = sharesWad - remainingSharesWad;
            if (remainingWei > 0) _sendValue(payable(msg.sender), remainingWei, "OB: refund failed");
        } else {
            require(msg.value == 0, "OB: ask cannot include value");
            require(
                IHybridMarket(market).moveShares(trader, address(this), outcome, sharesWad),
                "OB: share escrow failed"
            );
            uint256 remainingSharesWad;
            (remainingSharesWad, notionalWei, feeWei) =
                _matchIncomingAsk(market, outcome, trader, limitPriceWad, sharesWad, matches);
            sharesFilledWad = sharesWad - remainingSharesWad;
            if (remainingSharesWad > 0) {
                require(
                    IHybridMarket(market).moveShares(address(this), trader, outcome, remainingSharesWad),
                    "OB: share return failed"
                );
            }
        }

        // Router emits the user-facing aggregate TradeExecuted event for market orders.
    }

    function fillBestAsk(address market, uint256 outcome, address buyer, uint256 maxSharesWad)
        external
        payable
        nonReentrant
        onlyRouter
        returns (uint256 sharesFilledWad, uint256 notionalWei, uint256 makerFeeWei)
    {
        require(!paused, "OB: paused");
        require(buyer != address(0), "OB: zero buyer");
        require(maxSharesWad > 0, "OB: zero max shares");
        require(allowedMarket[market], "OB: market not allowed");
        require(IHybridMarket(market).isTradingOpen(), "OB: trading closed");

        uint256 orderId = _nextFillableOrder(market, outcome, Side.Ask);
        require(orderId != 0, "OB: no ask");

        Order storage order = orders[orderId];
        sharesFilledWad = _min(maxSharesWad, order.remainingSharesWad);
        notionalWei = _mulWad(sharesFilledWad, order.priceWad);
        makerFeeWei = _fee(notionalWei, makerFeeBps);
        require(msg.value >= notionalWei, "OB: insufficient payment");

        _applyFill(order, sharesFilledWad);
        require(
            IHybridMarket(market).moveShares(address(this), buyer, outcome, sharesFilledWad),
            "OB: share transfer failed"
        );

        uint256 makerProceeds = notionalWei - makerFeeWei;
        if (makerProceeds > 0) _sendValue(payable(order.owner), makerProceeds, "OB: maker payment failed");
        if (makerFeeWei > 0) _sendValue(payable(feeRecipient), makerFeeWei, "OB: maker fee failed");
        if (msg.value > notionalWei) _sendValue(payable(msg.sender), msg.value - notionalWei, "OB: refund failed");

        emit OrderFilled(orderId, market, buyer, outcome, Side.Ask, sharesFilledWad, notionalWei, makerFeeWei);
        _recordMarketPrice(market, outcome, order.priceWad);
    }

    function fillBestBid(
        address market,
        uint256 outcome,
        address seller,
        address payable proceedsRecipient,
        uint256 maxSharesWad
    )
        external
        nonReentrant
        onlyRouter
        returns (uint256 sharesFilledWad, uint256 notionalWei, uint256 makerFeeWei)
    {
        require(!paused, "OB: paused");
        require(seller != address(0), "OB: zero seller");
        require(proceedsRecipient != address(0), "OB: zero recipient");
        require(maxSharesWad > 0, "OB: zero max shares");
        require(allowedMarket[market], "OB: market not allowed");
        require(IHybridMarket(market).isTradingOpen(), "OB: trading closed");

        uint256 orderId = _nextFillableOrder(market, outcome, Side.Bid);
        require(orderId != 0, "OB: no bid");

        Order storage order = orders[orderId];
        sharesFilledWad = _min(maxSharesWad, order.remainingSharesWad);
        notionalWei = _mulWad(sharesFilledWad, order.priceWad);
        makerFeeWei = _fee(notionalWei, makerFeeBps);
        uint256 escrowUsed = notionalWei + makerFeeWei;
        require(order.escrowWei >= escrowUsed, "OB: bad escrow");

        order.escrowWei -= escrowUsed;
        _applyFill(order, sharesFilledWad);
        require(
            IHybridMarket(market).moveShares(seller, order.owner, outcome, sharesFilledWad),
            "OB: share transfer failed"
        );

        if (notionalWei > 0) _sendValue(proceedsRecipient, notionalWei, "OB: proceeds failed");
        if (makerFeeWei > 0) _sendValue(payable(feeRecipient), makerFeeWei, "OB: maker fee failed");
        if (!order.active && order.escrowWei > 0) {
            uint256 dustRefund = order.escrowWei;
            order.escrowWei = 0;
            _sendValue(payable(order.owner), dustRefund, "OB: dust refund failed");
        }

        emit OrderFilled(orderId, market, seller, outcome, Side.Bid, sharesFilledWad, notionalWei, makerFeeWei);
        _recordMarketPrice(market, outcome, order.priceWad);
    }

    function getBestBid(address market, uint256 outcome)
        external
        view
        returns (uint256 priceWad, uint256 sharesWad, uint256 orderId)
    {
        return _findBestView(market, outcome, Side.Bid);
    }

    function getBestAsk(address market, uint256 outcome)
        external
        view
        returns (uint256 priceWad, uint256 sharesWad, uint256 orderId)
    {
        return _findBestView(market, outcome, Side.Ask);
    }

    function getDepth(address market, uint256 outcome, uint8 sideRaw, uint256 maxLevels)
        external
        view
        returns (uint256[] memory pricesWad, uint256[] memory sharesWad)
    {
        require(sideRaw <= uint8(Side.Ask), "OB: invalid side");
        uint256 levels = WAD / tickSizeWad;
        uint256 limit = maxLevels == 0 || maxLevels > levels ? levels : maxLevels;
        pricesWad = new uint256[](limit);
        sharesWad = new uint256[](limit);

        Side side = Side(sideRaw);
        uint256 found;
        if (side == Side.Bid) {
            for (uint256 i = levels; i >= 1 && found < limit; ) {
                uint256 price = i * tickSizeWad;
                uint256 available = _availableAtLevel(market, outcome, side, price);
                if (available > 0) {
                    pricesWad[found] = price;
                    sharesWad[found] = available;
                    found++;
                }
                if (i == 1) break;
                unchecked { i--; }
            }
        } else {
            for (uint256 i = 1; i <= levels && found < limit; ) {
                uint256 price = i * tickSizeWad;
                uint256 available = _availableAtLevel(market, outcome, side, price);
                if (available > 0) {
                    pricesWad[found] = price;
                    sharesWad[found] = available;
                    found++;
                }
                unchecked { i++; }
            }
        }
    }

    function previewFill(
        address market,
        uint256 outcome,
        uint8 sideRaw,
        uint256 maxSharesWad,
        uint256 limitPriceWad
    ) external view returns (uint256 sharesFilledWad, uint256 notionalWei) {
        require(sideRaw <= uint8(Side.Ask), "OB: invalid side");
        require(maxSharesWad > 0, "OB: zero shares");
        Side side = Side(sideRaw);
        uint256 levels = WAD / tickSizeWad;

        if (side == Side.Bid) {
            for (uint256 i = levels; i >= 1 && sharesFilledWad < maxSharesWad; ) {
                uint256 price = i * tickSizeWad;
                if (price < limitPriceWad) break;
                (sharesFilledWad, notionalWei) = _previewLevel(
                    market,
                    outcome,
                    side,
                    price,
                    maxSharesWad,
                    sharesFilledWad,
                    notionalWei
                );
                if (i == 1) break;
                unchecked { i--; }
            }
        } else {
            for (uint256 i = 1; i <= levels && sharesFilledWad < maxSharesWad; ) {
                uint256 price = i * tickSizeWad;
                if (price > limitPriceWad) break;
                (sharesFilledWad, notionalWei) = _previewLevel(
                    market,
                    outcome,
                    side,
                    price,
                    maxSharesWad,
                    sharesFilledWad,
                    notionalWei
                );
                unchecked { i++; }
            }
        }
    }

    function levelLiquidity(address market, uint256 outcome, uint8 sideRaw, uint256 priceWad)
        external
        view
        returns (uint256)
    {
        require(sideRaw <= uint8(Side.Ask), "OB: invalid side");
        return _availableAtLevel(market, outcome, Side(sideRaw), priceWad);
    }

    function getUserOrderCount(address user) external view returns (uint256) {
        return _ownerOrderIds[user].length;
    }

    function getUserOrderIds(address user, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory orderIds)
    {
        uint256 total = _ownerOrderIds[user].length;
        if (offset >= total) return new uint256[](0);

        uint256 end = limit == 0 || offset + limit > total ? total : offset + limit;
        uint256 count = end - offset;
        orderIds = new uint256[](count);
        for (uint256 i = 0; i < count; ) {
            orderIds[i] = _ownerOrderIds[user][offset + i];
            unchecked { i++; }
        }
    }

    function getUserOrders(address user, address market, bool openOnly, uint256 offset, uint256 limit)
        external
        view
        returns (Order[] memory userOrders)
    {
        uint256 total = _ownerOrderIds[user].length;
        if (offset >= total) return new Order[](0);

        uint256 end = limit == 0 || offset + limit > total ? total : offset + limit;
        uint256 count;
        for (uint256 i = offset; i < end; ) {
            Order storage order = orders[_ownerOrderIds[user][i]];
            bool marketMatches = market == address(0) || order.market == market;
            bool statusMatches = !openOnly || (order.active && !_isExpired(order));
            if (marketMatches && statusMatches) count++;
            unchecked { i++; }
        }

        userOrders = new Order[](count);
        uint256 cursor;
        for (uint256 i = offset; i < end; ) {
            Order storage order = orders[_ownerOrderIds[user][i]];
            bool marketMatches = market == address(0) || order.market == market;
            bool statusMatches = !openOnly || (order.active && !_isExpired(order));
            if (marketMatches && statusMatches) {
                userOrders[cursor] = order;
                cursor++;
            }
            unchecked { i++; }
        }
    }

    function pruneExpiredOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.active, "OB: inactive order");
        require(_isExpired(order), "OB: not expired");

        uint256 remaining = order.remainingSharesWad;
        uint256 refundWei = order.escrowWei;
        address owner = order.owner;
        address market = order.market;
        uint256 outcome = order.outcome;
        Side side = order.side;
        uint256 priceWad = order.priceWad;

        order.active = false;
        order.remainingSharesWad = 0;
        order.escrowWei = 0;
        order.status = OrderStatus.Cancelled;
        _decreaseLevel(market, outcome, side, priceWad, remaining);

        if (side == Side.Bid) {
            if (refundWei > 0) _sendValue(payable(owner), refundWei, "OB: escrow refund failed");
        } else if (remaining > 0) {
            require(IHybridMarket(market).moveShares(address(this), owner, outcome, remaining), "OB: share return failed");
        }

        emit OrderPruned(orderId, market, outcome, side, priceWad);
    }

    function _storeOrder(
        address market,
        uint256 outcome,
        address owner_,
        Side side,
        uint256 priceWad,
        uint256 sharesWad,
        uint256 escrowWei,
        uint256 expiry
    ) internal returns (uint256 orderId) {
        orderId = nextOrderId++;
        orders[orderId] = Order({
            id: orderId,
            market: market,
            outcome: outcome,
            owner: owner_,
            side: side,
            priceWad: priceWad,
            remainingSharesWad: sharesWad,
            escrowWei: escrowWei,
            expiry: expiry,
            active: true,
            originalSharesWad: sharesWad,
            status: OrderStatus.Open
        });
        _ownerOrderIds[owner_].push(orderId);

        OrderQueue storage queue = _queues[_queueKey(market, outcome, side, priceWad)];
        queue.orderIds.push(orderId);
        queue.totalSharesWad += sharesWad;

        emit OrderPlaced(orderId, market, owner_, outcome, side, priceWad, sharesWad, expiry);
    }

    function _matchIncomingBid(
        address market,
        uint256 outcome,
        address buyer,
        uint256 limitPriceWad,
        uint256 sharesWad,
        uint256 availableWei,
        uint256 maxMatches
    )
        internal
        returns (uint256 remainingSharesWad, uint256 remainingWei, uint256 matchedNotionalWei, uint256 takerFeeWei)
    {
        remainingSharesWad = sharesWad;
        remainingWei = availableWei;

        uint256 matches;
        while (remainingSharesWad > 0 && matches < maxMatches) {
            (uint256 askPrice, uint256 askShares, uint256 askOrderId) = _findBestView(market, outcome, Side.Ask);
            if (askOrderId == 0 || askPrice > limitPriceWad) break;

            uint256 fillShares = _min(remainingSharesWad, askShares);
            (uint256 notionalWei, uint256 feeWei) =
                _fillAskWithBid(askOrderId, market, outcome, buyer, fillShares);
            require(remainingWei >= notionalWei + feeWei, "OB: insufficient value");
            remainingWei -= notionalWei + feeWei;
            matchedNotionalWei += notionalWei;
            takerFeeWei += feeWei;
            remainingSharesWad -= fillShares;
            unchecked { matches++; }
        }
    }

    function _matchIncomingAsk(
        address market,
        uint256 outcome,
        address seller,
        uint256 limitPriceWad,
        uint256 sharesWad,
        uint256 maxMatches
    ) internal returns (uint256 remainingSharesWad, uint256 matchedNotionalWei, uint256 takerFeeWei) {
        remainingSharesWad = sharesWad;

        uint256 matches;
        while (remainingSharesWad > 0 && matches < maxMatches) {
            (uint256 bidPrice, uint256 bidShares, uint256 bidOrderId) = _findBestView(market, outcome, Side.Bid);
            if (bidOrderId == 0 || bidPrice < limitPriceWad) break;

            uint256 fillShares = _min(remainingSharesWad, bidShares);
            (uint256 notionalWei, uint256 feeWei) =
                _fillBidWithAsk(bidOrderId, market, outcome, seller, fillShares);
            matchedNotionalWei += notionalWei;
            takerFeeWei += feeWei;
            remainingSharesWad -= fillShares;
            unchecked { matches++; }
        }
    }

    function _fillAskWithBid(
        uint256 orderId,
        address market,
        uint256 outcome,
        address buyer,
        uint256 sharesWad
    ) internal returns (uint256 notionalWei, uint256 feeWei) {
        Order storage order = orders[orderId];
        notionalWei = _mulWad(sharesWad, order.priceWad);
        feeWei = _fee(notionalWei, takerFeeBps);
        uint256 makerFeeWei = _fee(notionalWei, makerFeeBps);

        _applyFill(order, sharesWad);
        require(IHybridMarket(market).moveShares(address(this), buyer, outcome, sharesWad), "OB: share transfer failed");

        uint256 makerProceeds = notionalWei - makerFeeWei;
        if (makerProceeds > 0) _sendValue(payable(order.owner), makerProceeds, "OB: maker payment failed");
        _sendFees(feeWei + makerFeeWei);

        emit OrderMatched(orderId, market, buyer, outcome, Side.Ask, order.priceWad, sharesWad, notionalWei, feeWei);
        emit OrderFilled(orderId, market, buyer, outcome, Side.Ask, sharesWad, notionalWei, makerFeeWei);
        _recordMarketPrice(market, outcome, order.priceWad);
        _emitPartialIfActive(order);
    }

    function _fillBidWithAsk(
        uint256 orderId,
        address market,
        uint256 outcome,
        address seller,
        uint256 sharesWad
    ) internal returns (uint256 notionalWei, uint256 feeWei) {
        Order storage order = orders[orderId];
        notionalWei = _mulWad(sharesWad, order.priceWad);
        feeWei = _fee(notionalWei, takerFeeBps);
        require(order.escrowWei >= notionalWei, "OB: bad escrow");
        order.escrowWei -= notionalWei;

        _applyFill(order, sharesWad);
        require(IHybridMarket(market).moveShares(address(this), order.owner, outcome, sharesWad), "OB: share transfer failed");

        uint256 proceedsWei = notionalWei - feeWei;
        if (proceedsWei > 0) _sendValue(payable(seller), proceedsWei, "OB: proceeds failed");
        _sendFees(feeWei);
        _refundInactiveBidDust(order);

        emit OrderMatched(orderId, market, seller, outcome, Side.Bid, order.priceWad, sharesWad, notionalWei, feeWei);
        emit OrderFilled(orderId, market, seller, outcome, Side.Bid, sharesWad, notionalWei, 0);
        _recordMarketPrice(market, outcome, order.priceWad);
        _emitPartialIfActive(order);
    }

    function _sendFees(uint256 amountWei) internal {
        if (amountWei > 0) _sendValue(payable(feeRecipient), amountWei, "OB: fee failed");
    }

    function _recordMarketPrice(address market, uint256 outcome, uint256 priceWad) internal {
        require(IHybridMarket(market).recordTradePrice(outcome, priceWad), "OB: price record failed");
    }

    function _emitTradeExecuted(
        address trader,
        address market,
        uint256 outcome,
        Side side,
        uint256 sharesWad,
        uint256 notionalWei,
        uint256 feeWei
    ) internal {
        if (sharesWad == 0) return;
        emit TradeExecuted(
            trader,
            market,
            outcome,
            (notionalWei * WAD) / sharesWad,
            sharesWad,
            block.timestamp,
            ExecutionSource.CLOB,
            side,
            notionalWei,
            feeWei
        );
    }

    function _refundInactiveBidDust(Order storage order) internal {
        if (!order.active && order.side == Side.Bid && order.escrowWei > 0) {
            uint256 dustRefund = order.escrowWei;
            order.escrowWei = 0;
            _sendValue(payable(order.owner), dustRefund, "OB: dust refund failed");
        }
    }

    function _emitPartialIfActive(Order storage order) internal {
        if (order.active && order.remainingSharesWad > 0) {
            emit OrderPartiallyFilled(order.id, order.remainingSharesWad);
        }
    }

    function _setConstraints(
        uint256 _tickSizeWad,
        uint256 _minOrderSharesWad,
        uint256 _maxPriceDeviationBps
    ) internal {
        require(_tickSizeWad > 0 && _tickSizeWad <= WAD && WAD % _tickSizeWad == 0, "OB: invalid tick");
        require(WAD / _tickSizeWad <= MAX_PRICE_LEVELS, "OB: too many levels");
        require(_minOrderSharesWad > 0, "OB: invalid min order");
        require(_maxPriceDeviationBps <= MAX_BPS, "OB: invalid deviation");
        tickSizeWad = _tickSizeWad;
        minOrderSharesWad = _minOrderSharesWad;
        maxPriceDeviationBps = _maxPriceDeviationBps;
    }

    function _assertValidPrice(uint256 priceWad) internal view {
        require(priceWad > 0 && priceWad <= WAD, "OB: invalid price");
        require(priceWad % tickSizeWad == 0, "OB: invalid tick price");
    }

    function _assertPriceNearLmsr(address market, uint256 outcome, uint256 priceWad) internal view {
        uint256 current = IHybridMarket(market).getImpliedProbability(outcome);
        uint256 lower = (current * (MAX_BPS - maxPriceDeviationBps)) / MAX_BPS;
        uint256 upper = (current * (MAX_BPS + maxPriceDeviationBps)) / MAX_BPS;
        if (upper > WAD) upper = WAD;
        require(priceWad >= lower && priceWad <= upper, "OB: price outside band");
    }

    function _nextFillableOrder(address market, uint256 outcome, Side side) internal returns (uint256 orderId) {
        uint256 levels = WAD / tickSizeWad;
        if (side == Side.Bid) {
            for (uint256 i = levels; i >= 1; ) {
                orderId = _nextFillableAtLevel(market, outcome, side, i * tickSizeWad);
                if (orderId != 0) return orderId;
                if (i == 1) break;
                unchecked { i--; }
            }
        } else {
            for (uint256 i = 1; i <= levels; ) {
                orderId = _nextFillableAtLevel(market, outcome, side, i * tickSizeWad);
                if (orderId != 0) return orderId;
                unchecked { i++; }
            }
        }
    }

    function _nextFillableAtLevel(address market, uint256 outcome, Side side, uint256 priceWad)
        internal
        returns (uint256)
    {
        OrderQueue storage queue = _queues[_queueKey(market, outcome, side, priceWad)];
        while (queue.head < queue.orderIds.length) {
            uint256 orderId = queue.orderIds[queue.head];
            Order storage order = orders[orderId];
            if (order.active && order.remainingSharesWad > 0 && !_isExpired(order)) return orderId;
            queue.head++;
        }
        return 0;
    }

    function _findBestView(address market, uint256 outcome, Side side)
        internal
        view
        returns (uint256 priceWad, uint256 sharesWad, uint256 orderId)
    {
        uint256 levels = WAD / tickSizeWad;
        if (side == Side.Bid) {
            for (uint256 i = levels; i >= 1; ) {
                (sharesWad, orderId) = _firstAvailableAtLevel(market, outcome, side, i * tickSizeWad);
                if (orderId != 0) return (i * tickSizeWad, sharesWad, orderId);
                if (i == 1) break;
                unchecked { i--; }
            }
        } else {
            for (uint256 i = 1; i <= levels; ) {
                (sharesWad, orderId) = _firstAvailableAtLevel(market, outcome, side, i * tickSizeWad);
                if (orderId != 0) return (i * tickSizeWad, sharesWad, orderId);
                unchecked { i++; }
            }
        }
    }

    function _firstAvailableAtLevel(address market, uint256 outcome, Side side, uint256 priceWad)
        internal
        view
        returns (uint256 sharesWad, uint256 orderId)
    {
        OrderQueue storage queue = _queues[_queueKey(market, outcome, side, priceWad)];
        for (uint256 i = queue.head; i < queue.orderIds.length; ) {
            uint256 candidate = queue.orderIds[i];
            Order storage order = orders[candidate];
            if (order.active && order.remainingSharesWad > 0 && !_isExpired(order)) {
                return (order.remainingSharesWad, candidate);
            }
            unchecked { i++; }
        }
    }

    function _availableAtLevel(address market, uint256 outcome, Side side, uint256 priceWad)
        internal
        view
        returns (uint256 available)
    {
        OrderQueue storage queue = _queues[_queueKey(market, outcome, side, priceWad)];
        for (uint256 i = queue.head; i < queue.orderIds.length; ) {
            Order storage order = orders[queue.orderIds[i]];
            if (order.active && order.remainingSharesWad > 0 && !_isExpired(order)) {
                available += order.remainingSharesWad;
            }
            unchecked { i++; }
        }
    }

    function _previewLevel(
        address market,
        uint256 outcome,
        Side side,
        uint256 priceWad,
        uint256 maxSharesWad,
        uint256 sharesFilledWad,
        uint256 notionalWei
    ) internal view returns (uint256, uint256) {
        OrderQueue storage queue = _queues[_queueKey(market, outcome, side, priceWad)];
        for (uint256 i = queue.head; i < queue.orderIds.length && sharesFilledWad < maxSharesWad; ) {
            Order storage order = orders[queue.orderIds[i]];
            if (order.active && order.remainingSharesWad > 0 && !_isExpired(order)) {
                uint256 fill = _min(maxSharesWad - sharesFilledWad, order.remainingSharesWad);
                sharesFilledWad += fill;
                notionalWei += _mulWad(fill, priceWad);
            }
            unchecked { i++; }
        }
        return (sharesFilledWad, notionalWei);
    }

    function _applyFill(Order storage order, uint256 sharesWad) internal {
        order.remainingSharesWad -= sharesWad;
        _decreaseLevel(order.market, order.outcome, order.side, order.priceWad, sharesWad);
        if (order.remainingSharesWad == 0) {
            order.active = false;
            order.status = OrderStatus.Filled;
        } else {
            order.status = OrderStatus.PartiallyFilled;
        }
    }

    function _decreaseLevel(address market, uint256 outcome, Side side, uint256 priceWad, uint256 sharesWad) internal {
        OrderQueue storage queue = _queues[_queueKey(market, outcome, side, priceWad)];
        if (queue.totalSharesWad >= sharesWad) {
            queue.totalSharesWad -= sharesWad;
        } else {
            queue.totalSharesWad = 0;
        }
    }

    function _queueKey(address market, uint256 outcome, Side side, uint256 priceWad) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(market, outcome, side, priceWad));
    }

    function _isExpired(Order storage order) internal view returns (bool) {
        return order.expiry != 0 && order.expiry <= block.timestamp;
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
}
