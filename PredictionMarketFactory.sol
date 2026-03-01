// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PredictionMarket} from "./PredictionMarket.sol";
import {Ownable}           from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  PredictionMarketFactory
/// @notice Factory, registry, and global analytics hub.
///
///         • Deploys PredictionMarket contracts via createMarket()
///           — ALL market data (title, description, image, category,
///             outcomes, duration) is provided at creation.
///           — Market is immediately Active on deploy; no second step.
///
///         • Registers every market and provides paginated views for
///           the frontend market listing and global dashboard.
///
///         • User-level data lives entirely in each submarket contract.
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

    /// market address → registered?
    mapping(address => bool) public isMarket;

    /// market address → index in `markets`
    mapping(address => uint256) public marketIndex;

    /// Total markets ever created.
    uint256 public totalMarkets;

    // ── Creation guards ───────────────────────────────────────────
    int256  public minBWad              = 10e18;
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
    ///         All data is provided here — no further setup required.
    ///
    /// @param _title          Market question (e.g. "Will BTC hit $200k by end of 2025?").
    /// @param _description    Full description, context, and resolution criteria.
    /// @param _category       Category tag: "Crypto", "Sports", "Politics", "Entertainment", etc.
    /// @param _imageUri       Header/thumbnail image — IPFS CID or HTTPS URL.
    /// @param _outcomeLabels  Labels for each outcome.
    ///                        Binary:      ["Yes", "No"]
    ///                        Multi-choice: ["Team A", "Team B", "Draw"]
    ///                        Must have at least 2 outcomes.
    /// @param _bWad           LMSR liquidity parameter in WAD.
    ///                        Higher b → flatter prices, smaller multipliers, more stable odds.
    ///                        Lower b → steeper prices, bigger multipliers, more sensitive to volume.
    ///                        Good starting point: expected_total_volume_in_wei / 10.
    /// @param _durationSeconds  Market open window in seconds.
    ///                          Admin can resolve at any time before expiry.
    ///                          After expiry, anyone can call triggerExpiry() for auto-refund.
    ///
    /// @return market  Address of the newly deployed, immediately active PredictionMarket.
    function createMarket(
        string   calldata  _title,
        string   calldata  _description,
        string   calldata  _category,
        string   calldata  _imageUri,
        string[] calldata  _outcomeLabels,
        int256             _bWad,
        uint256            _durationSeconds
    ) external returns (address market) {

        // ── Input validation ──────────────────────────────────────
        require(bytes(_title).length       > 0, "Factory: empty title");
        require(bytes(_description).length > 0, "Factory: empty description");
        require(bytes(_category).length    > 0, "Factory: empty category");
        require(_outcomeLabels.length      >= 2, "Factory: need >= 2 outcomes");
        require(_bWad >= minBWad,               "Factory: b too small");
        require(
            _durationSeconds >= minDuration &&
            _durationSeconds <= maxDuration,
            "Factory: invalid duration"
        );

        // ── Deploy ────────────────────────────────────────────────
        // Admin of each submarket = factory owner (platform operator).
        // Market is immediately Active — no activation step needed.
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

        // ── Register ──────────────────────────────────────────────
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

    function setDurationBounds(uint256 _min, uint256 _max) external onlyOwner {
        require(_min < _max && _min > 0, "Factory: invalid bounds");
        minDuration = _min;
        maxDuration = _max;
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

    /// @notice Live global statistics — aggregates all submarkets.
    /// @dev    O(n) loop; for very large registries combine with off-chain indexing.
    function getGlobalStats() external view returns (GlobalStats memory stats) {
        stats.totalMarkets = totalMarkets;

        for (uint256 i = 0; i < markets.length; ) {
            PredictionMarket pm = PredictionMarket(payable(markets[i]));

            stats.totalVolumeWei   += pm.totalVolumeWei();
            stats.totalParticipants += pm.participantCount();

            PredictionMarket.Stage s = pm.stage();
            if      (s == PredictionMarket.Stage.Active)   stats.activeMarkets++;
            else if (s == PredictionMarket.Stage.Resolved) stats.resolvedMarkets++;
            else                                            stats.cancelledOrExpiredMarkets++;

            unchecked { i++; }
        }
    }

    /*//////////////////////////////////////////////////////////////
                   MARKET LIST — PAGINATED  (VIEW)
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
        int256[]  impliedProbabilitiesWad; // one per outcome, each 0–1e18
        // State
        PredictionMarket.Stage  stage;
        uint256   winningOutcome;
        uint256   marketDeadline;
        // Analytics
        uint256   totalVolumeWei;
        uint256   participants;
    }

    /// @notice Paginated market list with live LMSR probabilities — use for the home page.
    /// @param  offset  Start index.
    /// @param  limit   Max results per page.
    function getMarketSummaries(uint256 offset, uint256 limit)
        external
        view
        returns (MarketSummary[] memory summaries)
    {
        uint256 total = markets.length;
        if (offset >= total) return new MarketSummary[](0);

        uint256 end   = offset + limit > total ? total : offset + limit;
        uint256 count = end - offset;
        summaries     = new MarketSummary[](count);

        for (uint256 i = 0; i < count; ) {
            address     mAddr = markets[offset + i];
            PredictionMarket pm = PredictionMarket(payable(mAddr));

            (
                string memory _title,
                ,
                string memory _cat,
                string memory _img,
                ,
                string[] memory _labels,
                PredictionMarket.Stage _stage,
                uint256 _winning,
                ,
                uint256 _deadline,
                uint256 _vol,
                uint256 _part
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
                participants:            _part
            });

            unchecked { i++; }
        }
    }

    /*//////////////////////////////////////////////////////////////
                   MARKET DETAIL — SINGLE MARKET  (VIEW)
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
        uint256   resolvedPoolWei;      // pool after fee, set at resolution (0 if not resolved)
        uint256   resolutionDeadline;    // marketDeadline + RESOLUTION_GRACE_PERIOD
    }

    /// @notice Full detail for a single market — use for the market detail page.
    function getMarketDetail(address market)
        external
        view
        returns (MarketDetail memory d)
    {
        require(isMarket[market], "Factory: unknown market");
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
            uint256 _part
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
            resolutionDeadline:       pm.resolutionDeadline()
        });
    }

    /*//////////////////////////////////////////////////////////////
                   USER PORTFOLIO — ALL POSITIONS  (VIEW)
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
        // Count relevant markets first
        uint256 count;
        for (uint256 i = 0; i < markets.length; ) {
            if (_userHasPosition(markets[i], user)) count++;
            unchecked { i++; }
        }

        positions = new UserPosition[](count);
        uint256 idx;

        for (uint256 i = 0; i < markets.length && idx < count; ) {
            address mAddr = markets[i];
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
                ,
                string memory _cat,
                ,
                ,
                string[] memory _labels,
                PredictionMarket.Stage _stage,
                ,,,,
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
