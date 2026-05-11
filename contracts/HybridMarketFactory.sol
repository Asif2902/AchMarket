// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PredictionMarketV2} from "./PredictionMarketV2.sol";
import {MarketRouter} from "./MarketRouter.sol";
import {HybridOrderBook} from "./HybridOrderBook.sol";
import {LMSRMath} from "./LMSRMath.sol";
import {IResolutionManager} from "./interfaces/IResolutionManager.sol";

/// @title HybridMarketFactory
/// @notice Deploys and wires v2 LMSR+CLOB markets with replaceable resolution managers.
contract HybridMarketFactory is Ownable {
    address[] public markets;
    mapping(address => bool) public isMarket;
    mapping(address => uint256) public marketIndex;
    uint256 public totalMarkets;

    MarketRouter public router;
    HybridOrderBook public orderBook;
    address public defaultResolutionManager;

    int256 public minBWad = 1_000e18;
    int256 public maxBWad = 1_000_000e18;
    uint256 public minDuration = 1 hours;
    uint256 public maxDuration = 365 days;

    event MarketCreated(
        address indexed market,
        uint256 indexed marketId,
        address indexed creator,
        string title,
        string category,
        uint256 outcomeCount,
        uint256 deadline,
        uint256 resolutionTime,
        address resolutionManager
    );
    event RouterUpdated(address indexed router);
    event OrderBookUpdated(address indexed orderBook);
    event DefaultResolutionManagerUpdated(address indexed resolutionManager);
    event MarketResolutionManagerUpdated(address indexed market, address indexed resolutionManager);
    event MarketRegistered(address indexed market, uint256 indexed marketId);

    constructor(
        address _owner,
        address _router,
        address _orderBook,
        address _defaultResolutionManager
    ) Ownable(_owner) {
        require(_owner != address(0), "FactoryV2: zero owner");
        _setRouter(_router);
        _setOrderBook(_orderBook);
        _setDefaultResolutionManager(_defaultResolutionManager);
    }

    function createMarket(
        string calldata _title,
        string calldata _description,
        string calldata _category,
        string calldata _imageUri,
        string[] calldata _outcomeLabels,
        int256 _bWad,
        uint256 _durationSeconds,
        string calldata _resolutionSource,
        uint256 _resolutionTime,
        string calldata _fallbackResolutionSource,
        string calldata _invalidCondition
    ) external payable onlyOwner returns (address market) {
        _validateCreation(_title, _description, _category, _outcomeLabels, _bWad, _durationSeconds);

        address[] memory operators = new address[](2);
        operators[0] = address(router);
        operators[1] = address(orderBook);

        PredictionMarketV2 pm = new PredictionMarketV2{value: msg.value}(
            address(this),
            _title,
            _description,
            _category,
            _imageUri,
            _outcomeLabels,
            _bWad,
            _durationSeconds,
            _resolutionSource,
            _resolutionTime,
            _fallbackResolutionSource,
            _invalidCondition,
            defaultResolutionManager,
            operators
        );

        market = address(pm);
        _registerMarket(market);
        _wireMarket(market, defaultResolutionManager);

        emit MarketCreated(
            market,
            totalMarkets - 1,
            msg.sender,
            _title,
            _category,
            _outcomeLabels.length,
            block.timestamp + _durationSeconds,
            _resolutionTime,
            defaultResolutionManager
        );
    }

    function registerExistingMarket(address market, address resolutionManager) external onlyOwner {
        require(market != address(0), "FactoryV2: zero market");
        require(!isMarket[market], "FactoryV2: already registered");
        _registerMarket(market);
        _wireMarket(market, resolutionManager);
        emit MarketRegistered(market, totalMarkets - 1);
    }

    function setRouter(address _router) external onlyOwner {
        _setRouter(_router);
        emit RouterUpdated(_router);
    }

    function setOrderBook(address _orderBook) external onlyOwner {
        _setOrderBook(_orderBook);
        emit OrderBookUpdated(_orderBook);
    }

    function setDefaultResolutionManager(address _resolutionManager) external onlyOwner {
        _setDefaultResolutionManager(_resolutionManager);
        emit DefaultResolutionManagerUpdated(_resolutionManager);
    }

    function setMarketResolutionManager(address market, address resolutionManager) external onlyOwner {
        require(isMarket[market], "FactoryV2: unknown market");
        require(resolutionManager != address(0), "FactoryV2: zero resolver");
        PredictionMarketV2(payable(market)).setResolutionManager(resolutionManager);
        IResolutionManager(resolutionManager).setMarketAllowed(market, true);
        emit MarketResolutionManagerUpdated(market, resolutionManager);
    }

    function setMarketOperator(address market, address operator, bool allowed) external onlyOwner {
        require(isMarket[market], "FactoryV2: unknown market");
        PredictionMarketV2(payable(market)).setAuthorizedOperator(operator, allowed);
    }

    function setMarketAllowed(address market, bool allowed) external onlyOwner {
        require(isMarket[market], "FactoryV2: unknown market");
        router.setAllowedMarket(market, allowed);
        orderBook.setAllowedMarket(market, allowed);
    }

    function editMarket(
        address market,
        string calldata _title,
        string calldata _description,
        string calldata _category
    ) external onlyOwner {
        require(isMarket[market], "FactoryV2: unknown market");
        PredictionMarketV2(payable(market)).editMarket(_title, _description, _category);
    }

    function editResolutionRules(
        address market,
        string calldata _resolutionSource,
        uint256 _resolutionTime,
        string calldata _fallbackResolutionSource,
        string calldata _invalidCondition
    ) external onlyOwner {
        require(isMarket[market], "FactoryV2: unknown market");
        PredictionMarketV2(payable(market)).editResolutionRules(
            _resolutionSource,
            _resolutionTime,
            _fallbackResolutionSource,
            _invalidCondition
        );
    }

    function emergencyCancelMarket(address market, string calldata reason, string calldata proofUri) external onlyOwner {
        require(isMarket[market], "FactoryV2: unknown market");
        PredictionMarketV2(payable(market)).emergencyCancel(reason, proofUri);
    }

    function withdrawNative(address payable recipient, uint256 amountWei) external onlyOwner {
        require(recipient != address(0), "FactoryV2: zero recipient");
        require(address(this).balance >= amountWei, "FactoryV2: insufficient balance");
        (bool ok,) = recipient.call{value: amountWei}("");
        require(ok, "FactoryV2: transfer failed");
    }

    function setMinBWad(int256 _min) external onlyOwner {
        require(_min > 0, "FactoryV2: b must be > 0");
        minBWad = _min;
    }

    function setMaxBWad(int256 _max) external onlyOwner {
        require(_max > minBWad, "FactoryV2: max must be > min");
        maxBWad = _max;
    }

    function setDurationBounds(uint256 _min, uint256 _max) external onlyOwner {
        require(_min < _max && _min > 0, "FactoryV2: invalid bounds");
        minDuration = _min;
        maxDuration = _max;
    }

    function getMarketCount() external view returns (uint256) {
        return markets.length;
    }

    function getMarkets(uint256 offset, uint256 limit) external view returns (address[] memory slice) {
        uint256 total = markets.length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit > total ? total : offset + limit;
        uint256 count = end - offset;
        slice = new address[](count);
        for (uint256 i = 0; i < count; ) {
            slice[i] = markets[offset + i];
            unchecked { i++; }
        }
    }

    function requiredSeed(int256 bWad, uint256 outcomeCount) external pure returns (uint256) {
        return uint256(LMSRMath.initialLiquidity(outcomeCount, bWad));
    }

    function _registerMarket(address market) internal {
        marketIndex[market] = markets.length;
        markets.push(market);
        isMarket[market] = true;
        totalMarkets++;
    }

    function _wireMarket(address market, address resolutionManager) internal {
        router.setAllowedMarket(market, true);
        orderBook.setAllowedMarket(market, true);
        IResolutionManager(resolutionManager).setMarketAllowed(market, true);
    }

    function _validateCreation(
        string calldata _title,
        string calldata _description,
        string calldata _category,
        string[] calldata _outcomeLabels,
        int256 _bWad,
        uint256 _durationSeconds
    ) internal view {
        require(bytes(_title).length > 0, "FactoryV2: empty title");
        require(bytes(_description).length > 0, "FactoryV2: empty description");
        require(bytes(_category).length > 0, "FactoryV2: empty category");
        require(_outcomeLabels.length >= 2, "FactoryV2: need outcomes");
        require(_bWad >= minBWad, "FactoryV2: b too small");
        require(_bWad <= maxBWad, "FactoryV2: b too large");
        require(
            _durationSeconds >= minDuration && _durationSeconds <= maxDuration,
            "FactoryV2: invalid duration"
        );
    }

    function _setRouter(address _router) internal {
        require(_router != address(0), "FactoryV2: zero router");
        router = MarketRouter(payable(_router));
    }

    function _setOrderBook(address _orderBook) internal {
        require(_orderBook != address(0), "FactoryV2: zero order book");
        orderBook = HybridOrderBook(_orderBook);
    }

    function _setDefaultResolutionManager(address _resolutionManager) internal {
        require(_resolutionManager != address(0), "FactoryV2: zero resolver");
        defaultResolutionManager = _resolutionManager;
    }

    receive() external payable {}
}
