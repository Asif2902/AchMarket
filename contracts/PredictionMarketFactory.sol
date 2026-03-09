// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PredictionMarket} from "./PredictionMarket.sol";
import {Ownable}           from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  PredictionMarketFactory
/// @notice Factory and registry for PredictionMarket contracts.
///
///         * Deploys PredictionMarket contracts via createMarket()
///           -- ALL market data (title, description, image, category,
///              outcomes, duration) is provided at creation.
///           -- Market is immediately Active on deploy; no second step.
///
///         * Registers every market in an on-chain array for enumeration.
///
///         * Read-only analytics (getGlobalStats, getMarketSummaries,
///           getMarketDetail, getUserPortfolio) live in PredictionMarketLens
///           to keep this contract under the 24 KB limit.
///
contract PredictionMarketFactory is Ownable {

    /*//////////////////////////////////////////////////////////////
                               EVENTS
    //////////////////////////////////////////////////////////////*/

    event MarketCreated(
        address  indexed market,
        uint256  indexed marketId,
        address  indexed creator,
        string   title,
        string   category,
        uint256  outcomeCount,
        uint256  deadline
    );

    /*//////////////////////////////////////////////////////////////
                              STORAGE
    //////////////////////////////////////////////////////////////*/

    /// All deployed market addresses in creation order.
    address[] public markets;

    /// market address -> registered?
    mapping(address => bool) public isMarket;

    /// market address -> index in `markets`
    mapping(address => uint256) public marketIndex;

    /// Total markets ever created.
    uint256 public totalMarkets;

    // -- Creation guards ------------------------------------------
    int256  public minBWad              = 1_000e18;
    int256  public maxBWad              = 1_000_000e18;
    uint256 public minDuration          = 1 hours;
    uint256 public maxDuration          = 365 days;

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _owner) Ownable(_owner) {}

    /*//////////////////////////////////////////////////////////////
                          MARKET CREATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Create and immediately activate a new prediction market.
    function createMarket(
        string   calldata  _title,
        string   calldata  _description,
        string   calldata  _category,
        string   calldata  _imageUri,
        string[] calldata  _outcomeLabels,
        int256             _bWad,
        uint256            _durationSeconds
    ) external returns (address market) {

        // -- Input validation -------------------------------------
        require(bytes(_title).length       > 0, "Factory: empty title");
        require(bytes(_description).length > 0, "Factory: empty description");
        require(bytes(_category).length    > 0, "Factory: empty category");
        require(_outcomeLabels.length      >= 2, "Factory: need >= 2 outcomes");
        require(_bWad >= minBWad,               "Factory: b too small");
        require(_bWad <= maxBWad,               "Factory: b too large");
        require(
            _durationSeconds >= minDuration &&
            _durationSeconds <= maxDuration,
            "Factory: invalid duration"
        );

        // -- Deploy -----------------------------------------------
        PredictionMarket pm = new PredictionMarket(
            owner(),
            _title,
            _description,
            _category,
            _imageUri,
            _outcomeLabels,
            _bWad,
            _durationSeconds
        );

        market = address(pm);

        // -- Register ---------------------------------------------
        marketIndex[market] = markets.length;
        markets.push(market);
        isMarket[market]    = true;
        totalMarkets++;

        emit MarketCreated(
            market,
            totalMarkets - 1,
            msg.sender,
            _title,
            _category,
            _outcomeLabels.length,
            block.timestamp + _durationSeconds
        );
    }

    /*//////////////////////////////////////////////////////////////
                     OWNER CONFIGURATION
    //////////////////////////////////////////////////////////////*/

    function setMinBWad(int256 _min) external onlyOwner {
        require(_min > 0, "Factory: b must be > 0");
        minBWad = _min;
    }

    function setMaxBWad(int256 _max) external onlyOwner {
        require(_max > minBWad, "Factory: max must be > min");
        maxBWad = _max;
    }

    function setDurationBounds(uint256 _min, uint256 _max) external onlyOwner {
        require(_min < _max && _min > 0, "Factory: invalid bounds");
        minDuration = _min;
        maxDuration = _max;
    }

    /// @notice Edit an existing market's title and description.
    function editMarket(
        address market,
        string calldata _title,
        string calldata _description
    ) external onlyOwner {
        require(isMarket[market], "Factory: unknown market");
        PredictionMarket(payable(market)).editMarket(_title, _description);
    }

    /*//////////////////////////////////////////////////////////////
                          PUBLIC GETTERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Total number of registered markets.
    function getMarketCount() external view returns (uint256) {
        return markets.length;
    }

    /// @notice Return a slice of the markets array (for Lens or off-chain use).
    function getMarkets(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory slice)
    {
        uint256 total = markets.length;
        if (offset >= total) return new address[](0);

        uint256 end   = offset + limit > total ? total : offset + limit;
        uint256 count = end - offset;
        slice = new address[](count);
        for (uint256 i = 0; i < count; ) {
            slice[i] = markets[offset + i];
            unchecked { i++; }
        }
    }
}
