// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LMSRMath} from "./LMSRMath.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  PredictionMarket
/// @notice Self-contained prediction market with:
///           * N outcomes (binary YES/NO or multi-outcome)
///           * LMSR dynamic pricing (buy AND sell, any amount)
///           * Hardcoded 0.25% platform fee on resolved markets (immutable)
///           * Admin resolution with mandatory proof attachment
///           * 3-day grace period after deadline for admin to resolve/cancel
///           * Auto-expiry after grace period -> full refunds
///           * Admin cancellation -> full refunds
///
///         Deployed by PredictionMarketFactory with ALL market data
///         provided at creation -- immediately Active on deploy.
///
contract PredictionMarket is ReentrancyGuard {
    using LMSRMath for int256;

    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/

    enum Stage {
        Active,     // trading open
        Suspended,  // trading paused, can resume
        Resolved,   // winning outcome set, winners can redeem
        Cancelled,  // admin cancelled, everyone refunded
        Expired     // grace period passed without resolution, everyone refunded
    }

    /*//////////////////////////////////////////////////////////////
                               CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Platform fee in basis points. 25 = 0.25%.
    ///         Applied only when market is resolved -- deducted from the
    ///         pool before winners redeem. Cannot be changed.
    uint256 public constant PLATFORM_FEE_BPS = 25;

    /// @notice After the market deadline, the admin has this much time
    ///         to resolve or cancel before the market auto-expires.
    ///         During the grace period trading is closed but refunds
    ///         are not yet available.
    uint256 public constant RESOLUTION_GRACE_PERIOD = 3 days;

    /*//////////////////////////////////////////////////////////////
                               EVENTS
    //////////////////////////////////////////////////////////////*/

    event SharesBought(
        address indexed trader,
        uint256 indexed outcomeIndex,
        uint256         sharesWad,
        uint256         costWei
    );
    event SharesSold(
        address indexed trader,
        uint256 indexed outcomeIndex,
        uint256         sharesWad,
        uint256         proceedsWei
    );
    event MarketResolved(uint256 winningOutcome, string proofUri);
    event MarketCancelled(string reason, string proofUri);
    event MarketEdited(string newTitle, string newDescription, string newCategory);
    event MarketSuspended();
    event MarketResumed();
    event DeadlineEdited(uint256 newDeadline);
    event Redeemed(address indexed user, uint256 amountWei);
    event Refunded(address indexed user, uint256 amountWei);
    event FeeCollected(address indexed recipient, uint256 amountWei);

    /*//////////////////////////////////////////////////////////////
                              STORAGE
    //////////////////////////////////////////////////////////////*/

    // -- Metadata (all set at creation, immediately active) --------
    string  public title;
    string  public description;
    string  public category;
    string  public imageUri;
    uint256 public createdAt;

    // -- Outcomes -------------------------------------------------
    string[] public outcomeLabels;        // e.g. ["Yes","No"] or ["A","B","Draw"]
    uint256  public outcomeCount;

    // -- Admin ----------------------------------------------------
    address public admin;

    // -- LMSR -----------------------------------------------------
    int256  public b;                     // liquidity parameter (WAD)
    int256[] public totalSharesWad;       // total shares per outcome (WAD)

    // -- User balances --------------------------------------------
    // user => outcome index => shares held (WAD)
    mapping(address => mapping(uint256 => uint256)) public sharesOf;
    // user => total net ETH deposited (increases on buy, decreases on sell)
    mapping(address => uint256) public netDepositedWei;

    // -- Lifecycle ------------------------------------------------
    Stage   public stage;
    uint256 public winningOutcome;        // valid only when stage == Resolved
    uint256 public marketDeadline;        // unix timestamp; trading closes here
    string  public proofUri;             // admin-attached resolution proof
    string  public cancelReason;          // reason when cancelled
    string  public cancelProofUri;        // proof link when cancelled

    // -- Fee / Redemption -----------------------------------------
    /// @notice Pool balance snapshotted at resolution time (after fee).
    ///         Used for fair pro-rata redemptions regardless of order.
    uint256 public resolvedPoolWei;

    // -- Analytics ------------------------------------------------
    uint256 public totalVolumeWei;        // cumulative buy+sell volume (analytics)
    uint256 public totalNetDepositedWei;  // sum of all users' net deposits (for refund pro-rata)
    uint256 public participantCount;

    mapping(address => bool) private  _hasParticipated;
    mapping(address => bool) public   hasRedeemed;
    mapping(address => bool) public   hasRefunded;

    /*//////////////////////////////////////////////////////////////
                             MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyAdmin() {
        require(msg.sender == admin, "PM: not admin");
        _;
    }

    modifier onlyActive() {
        _assertActive();
        _;
    }

    modifier onlyTradingAllowed() {
        _assertTradingAllowed();
        _;
    }

    modifier onlyEditable() {
        require(
            stage == Stage.Active || stage == Stage.Suspended,
            "PM: market not editable"
        );
        _;
    }

    /*//////////////////////////////////////////////////////////////
                           CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice All market data is provided at creation.
    ///         The market is immediately Active -- no separate activation step.
    constructor(
        address          _admin,
        string  memory   _title,
        string  memory   _description,
        string  memory   _category,
        string  memory   _imageUri,
        string[] memory  _outcomeLabels,
        int256           _bWad,
        uint256          _durationSeconds
    ) {
        require(_admin  != address(0),       "PM: zero admin");
        require(_bWad   > 0,                 "PM: b must be > 0");
        require(_outcomeLabels.length >= 2,  "PM: need at least 2 outcomes");
        require(_durationSeconds >= 1 hours, "PM: duration too short");

        admin          = _admin;
        title          = _title;
        description    = _description;
        category       = _category;
        imageUri       = _imageUri;
        b              = _bWad;
        createdAt      = block.timestamp;
        marketDeadline = block.timestamp + _durationSeconds;
        stage          = Stage.Active; // immediately active

        outcomeCount = _outcomeLabels.length;
        for (uint256 i = 0; i < _outcomeLabels.length; ) {
            outcomeLabels.push(_outcomeLabels[i]);
            totalSharesWad.push(0);
            unchecked { i++; }
        }
    }

    /*//////////////////////////////////////////////////////////////
                            BUYING SHARES
    //////////////////////////////////////////////////////////////*/

    /// @notice Buy shares of any outcome.
    function buy(
        uint256 outcomeIdx,
        uint256 sharesWad,
        uint256 maxCostWei
    )
        external
        payable
        nonReentrant
        onlyTradingAllowed
    {
        require(block.timestamp <= marketDeadline, "PM: trading period ended");
        require(outcomeIdx < outcomeCount, "PM: invalid outcome");
        require(sharesWad  > 0,           "PM: zero shares");

        int256[] memory q = _getSharesArray();
        int256 rawCost = LMSRMath.tradeCost(q, outcomeIdx, int256(sharesWad), b);
        require(rawCost >= 0, "PM: unexpected negative buy cost");

        uint256 costWei = uint256(rawCost);
        require(costWei <= maxCostWei,  "PM: slippage exceeded");
        require(msg.value >= costWei,   "PM: insufficient ETH");

        // Update state
        totalSharesWad[outcomeIdx]         += int256(sharesWad);
        sharesOf[msg.sender][outcomeIdx]   += sharesWad;
        netDepositedWei[msg.sender]        += costWei;
        totalVolumeWei                     += costWei;
        totalNetDepositedWei               += costWei;
        _trackParticipant(msg.sender);

        // Refund excess ETH to caller
        uint256 excess = msg.value - costWei;
        if (excess > 0) {
            (bool ok,) = msg.sender.call{value: excess}("");
            require(ok, "PM: excess refund failed");
        }

        emit SharesBought(msg.sender, outcomeIdx, sharesWad, costWei);
    }

    /*//////////////////////////////////////////////////////////////
                            SELLING SHARES
    //////////////////////////////////////////////////////////////*/

    /// @notice Sell previously purchased shares back to the market.
    function sell(
        uint256 outcomeIdx,
        uint256 sharesWad,
        uint256 minReceiveWei
    )
        external
        nonReentrant
        onlyTradingAllowed
    {
        require(block.timestamp <= marketDeadline, "PM: trading period ended");
        require(outcomeIdx < outcomeCount, "PM: invalid outcome");
        require(sharesWad  > 0,           "PM: zero shares");
        require(
            sharesOf[msg.sender][outcomeIdx] >= sharesWad,
            "PM: insufficient shares"
        );

        // Selling = negative delta in LMSR -> negative cost -> user receives ETH
        int256[] memory q        = _getSharesArray();
        int256   rawCost         = LMSRMath.tradeCost(q, outcomeIdx, -int256(sharesWad), b);
        require(rawCost <= 0, "PM: unexpected positive sell cost");

        uint256 proceedsWei = rawCost < 0 ? uint256(-rawCost) : 0;
        require(proceedsWei >= minReceiveWei, "PM: slippage exceeded");

        // Update state
        totalSharesWad[outcomeIdx]          -= int256(sharesWad);
        sharesOf[msg.sender][outcomeIdx]    -= sharesWad;
        totalVolumeWei                      += proceedsWei;

        if (proceedsWei > 0) {
            require(address(this).balance >= proceedsWei, "PM: insufficient liquidity");

            // Adjust net deposited (cap at zero to avoid underflow on profit)
            uint256 depositReduction;
            if (netDepositedWei[msg.sender] >= proceedsWei) {
                depositReduction = proceedsWei;
                netDepositedWei[msg.sender] -= proceedsWei;
            } else {
                depositReduction = netDepositedWei[msg.sender];
                netDepositedWei[msg.sender] = 0;
            }
            // Track aggregate net deposits for accurate refund pro-rata
            if (depositReduction > 0) {
                totalNetDepositedWei -= depositReduction;
            }

            (bool ok,) = msg.sender.call{value: proceedsWei}("");
            require(ok, "PM: sell transfer failed");
        }

        emit SharesSold(msg.sender, outcomeIdx, sharesWad, proceedsWei);
    }

    /*//////////////////////////////////////////////////////////////
                           ADMIN: RESOLVE
    //////////////////////////////////////////////////////////////*/

    /// @notice Admin resolves the market while it is Active or Suspended.
    function resolve(uint256 _winningOutcome, string calldata _proofUri)
        external
        onlyAdmin
    {
        // Auto-expire if grace period has passed
        if ((stage == Stage.Active || stage == Stage.Suspended) && block.timestamp > marketDeadline + RESOLUTION_GRACE_PERIOD) {
            stage = Stage.Expired;
            emit MarketCancelled("Auto-expired after grace period", "");
        }

        require(stage == Stage.Active || stage == Stage.Suspended, "PM: market not active or grace period expired");
        require(_winningOutcome < outcomeCount, "PM: invalid outcome index");
        require(bytes(_proofUri).length > 0,    "PM: proof URI required");

        winningOutcome = _winningOutcome;
        proofUri       = _proofUri;
        stage          = Stage.Resolved;

        // -- Platform fee (0.25%) ---------------------------------
        uint256 pool = address(this).balance;
        uint256 fee  = (pool * PLATFORM_FEE_BPS) / 10000;
        resolvedPoolWei = pool - fee;

        if (fee > 0) {
            (bool ok,) = admin.call{value: fee}("");
            require(ok, "PM: fee transfer failed");
            emit FeeCollected(admin, fee);
        }

        emit MarketResolved(_winningOutcome, _proofUri);
    }

    /*//////////////////////////////////////////////////////////////
                           ADMIN: CANCEL
    //////////////////////////////////////////////////////////////*/

    /// @notice Admin cancels the market; all deposited ETH becomes refundable.
    function cancel(string calldata reason, string calldata _proofUri)
        external
        onlyAdmin
    {
        require(stage == Stage.Active || stage == Stage.Suspended, "PM: not active or suspended");
        require(bytes(reason).length > 0, "PM: reason required");
        require(bytes(_proofUri).length > 0, "PM: proof URI required");
        cancelReason   = reason;
        cancelProofUri = _proofUri;
        stage = Stage.Cancelled;
        emit MarketCancelled(reason, _proofUri);
    }

    /*//////////////////////////////////////////////////////////////
                       ADMIN: EDIT MARKET
    //////////////////////////////////////////////////////////////*/

    /// @notice Admin can edit the market title, description, and category while Active or Suspended.
    function editMarket(
        string calldata _title,
        string calldata _description,
        string calldata _category
    )
        external
        onlyAdmin
        onlyEditable
    {
        require(bytes(_title).length > 0, "PM: empty title");
        require(bytes(_description).length > 0, "PM: empty description");
        require(bytes(_category).length > 0, "PM: empty category");
        title       = _title;
        description = _description;
        category    = _category;
        emit MarketEdited(_title, _description, _category);
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN: SUSPEND / RESUME
    //////////////////////////////////////////////////////////////*/

    /// @notice Admin suspends trading (Active -> Suspended).
    function suspend() external onlyAdmin {
        require(stage == Stage.Active, "PM: not active");
        stage = Stage.Suspended;
        emit MarketSuspended();
    }

    /// @notice Admin resumes trading (Suspended -> Active).
    function resume() external onlyAdmin {
        require(stage == Stage.Suspended, "PM: not suspended");
        stage = Stage.Active;
        emit MarketResumed();
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN: EDIT DEADLINE
    //////////////////////////////////////////////////////////////*/

    /// @notice Admin edits the market deadline while Active or Suspended.
    function editDeadline(uint256 newDeadline) external onlyAdmin onlyEditable {
        require(newDeadline > block.timestamp, "PM: deadline must be in future");
        marketDeadline = newDeadline;
        emit DeadlineEdited(newDeadline);
    }

    /*//////////////////////////////////////////////////////////////
                        EXPIRY (ANYONE CAN TRIGGER)
    //////////////////////////////////////////////////////////////*/

    /// @notice Anyone may call this after the resolution grace period.
    function triggerExpiry() external {
        require(stage == Stage.Active || stage == Stage.Suspended, "PM: not active or suspended");
        require(
            block.timestamp > marketDeadline + RESOLUTION_GRACE_PERIOD,
            "PM: resolution grace period not passed"
        );
        stage = Stage.Expired;
        emit MarketCancelled("Expired: not resolved within grace period", "");
    }

    /*//////////////////////////////////////////////////////////////
                          REDEEM  (WINNERS)
    //////////////////////////////////////////////////////////////*/

    /// @notice Winners redeem their shares for ETH after market is resolved.
    function redeem() external nonReentrant {
        require(stage == Stage.Resolved, "PM: not resolved");
        require(!hasRedeemed[msg.sender], "PM: already redeemed");

        uint256 userWinShares   = sharesOf[msg.sender][winningOutcome];
        uint256 totalWinShares  = uint256(totalSharesWad[winningOutcome]);

        require(userWinShares  > 0, "PM: no winning shares");
        require(totalWinShares > 0, "PM: no total winning shares");

        hasRedeemed[msg.sender] = true;

        uint256 payout = (userWinShares * resolvedPoolWei) / totalWinShares;

        (bool ok,) = msg.sender.call{value: payout}("");
        require(ok, "PM: payout failed");

        emit Redeemed(msg.sender, payout);
    }

    /*//////////////////////////////////////////////////////////////
                          REFUND (CANCELLED / EXPIRED)
    //////////////////////////////////////////////////////////////*/

    /// @notice Refund deposited ETH when the market is cancelled or expired.
    function refund() external nonReentrant {
        require(
            stage == Stage.Cancelled || stage == Stage.Expired,
            "PM: refunds not open"
        );
        require(!hasRefunded[msg.sender], "PM: already refunded");

        uint256 userDeposit = netDepositedWei[msg.sender];
        require(userDeposit > 0, "PM: nothing to refund");

        hasRefunded[msg.sender] = true;

        // Pro-rata: user gets back their share of the remaining contract balance
        uint256 bal    = address(this).balance;
        uint256 payout = totalNetDepositedWei > 0
            ? (userDeposit * bal) / totalNetDepositedWei
            : 0;
        if (payout > bal) payout = bal; // safety cap

        (bool ok,) = msg.sender.call{value: payout}("");
        require(ok, "PM: refund failed");

        emit Refunded(msg.sender, payout);
    }

    /*//////////////////////////////////////////////////////////////
                      FRONTEND VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Full market snapshot for the detail page.
    function getMarketInfo()
        external
        view
        returns (
            string   memory _title,
            string   memory _description,
            string   memory _category,
            string   memory _imageUri,
            string   memory _proofUri,
            string[] memory _outcomeLabels,
            Stage            _stage,
            uint256          _winningOutcome,
            uint256          _createdAt,
            uint256          _marketDeadline,
            uint256          _totalVolumeWei,
            uint256          _participantCount,
            string   memory _cancelReason,
            string   memory _cancelProofUri
        )
    {
        return (
            title,
            description,
            category,
            imageUri,
            proofUri,
            outcomeLabels,
            stage,
            winningOutcome,
            createdAt,
            marketDeadline,
            totalVolumeWei,
            participantCount,
            cancelReason,
            cancelProofUri
        );
    }

    /// @notice Returns current total shares per outcome (WAD array).
    function getShares() external view returns (int256[] memory) {
        return totalSharesWad;
    }

    /// @notice Returns implied probability for every outcome (WAD array, sums to ~1e18).
    function getImpliedProbabilities() external view returns (int256[] memory probs) {
        int256[] memory q = _getSharesArray();
        probs = new int256[](outcomeCount);

        // If no trades yet -> uniform distribution
        bool anyTrades;
        for (uint256 i = 0; i < outcomeCount; ) {
            if (q[i] > 0) { anyTrades = true; break; }
            unchecked { i++; }
        }
        if (!anyTrades) {
            int256 uniform = int256(1e18) / int256(outcomeCount);
            for (uint256 i = 0; i < outcomeCount; ) {
                probs[i] = uniform;
                unchecked { i++; }
            }
            return probs;
        }

        for (uint256 i = 0; i < outcomeCount; ) {
            probs[i] = LMSRMath.impliedProbability(q, i, b);
            unchecked { i++; }
        }
    }

    /// @notice Preview cost (wei) to buy `sharesWad` of `outcomeIdx`.
    function previewBuy(uint256 outcomeIdx, uint256 sharesWad)
        external view returns (uint256 costWei)
    {
        require(outcomeIdx < outcomeCount, "PM: invalid outcome");
        int256[] memory q = _getSharesArray();
        int256 raw = LMSRMath.tradeCost(q, outcomeIdx, int256(sharesWad), b);
        costWei = raw > 0 ? uint256(raw) : 0;
    }

    /// @notice Preview proceeds (wei) from selling `sharesWad` of `outcomeIdx`.
    function previewSell(uint256 outcomeIdx, uint256 sharesWad)
        external view returns (uint256 proceedsWei)
    {
        require(outcomeIdx < outcomeCount, "PM: invalid outcome");
        int256[] memory q = _getSharesArray();
        int256 raw = LMSRMath.tradeCost(q, outcomeIdx, -int256(sharesWad), b);
        proceedsWei = raw < 0 ? uint256(-raw) : 0;
    }

    /// @notice Per-user data for the portfolio / position panel.
    function getUserInfo(address user)
        external
        view
        returns (
            uint256[] memory _shares,        // shares per outcome
            uint256          _netDeposited,  // net ETH deposited
            bool             _redeemed,
            bool             _refunded,
            bool             _canRedeem,
            bool             _canRefund
        )
    {
        _shares = new uint256[](outcomeCount);
        for (uint256 i = 0; i < outcomeCount; ) {
            _shares[i] = sharesOf[user][i];
            unchecked { i++; }
        }

        _netDeposited = netDepositedWei[user];
        _redeemed     = hasRedeemed[user];
        _refunded     = hasRefunded[user];
        _canRedeem    = (stage == Stage.Resolved)
                        && !hasRedeemed[user]
                        && sharesOf[user][winningOutcome] > 0;
        _canRefund    = (stage == Stage.Cancelled || stage == Stage.Expired)
                        && !hasRefunded[user]
                        && netDepositedWei[user] > 0;
    }

    /// @notice Deadline by which admin must resolve or cancel.
    function resolutionDeadline() external view returns (uint256) {
        return marketDeadline + RESOLUTION_GRACE_PERIOD;
    }

    /*//////////////////////////////////////////////////////////////
                          INTERNAL HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Snapshot the shares array into a fresh int256[] for LMSR calls.
    function _getSharesArray() internal view returns (int256[] memory q) {
        q = new int256[](outcomeCount);
        for (uint256 i = 0; i < outcomeCount; ) {
            q[i] = totalSharesWad[i];
            unchecked { i++; }
        }
    }

    /// @dev Check market is Active; auto-transition to Expired if
    ///      the resolution grace period (deadline + 3 days) has passed.
    function _assertActive() internal {
        if ((stage == Stage.Active || stage == Stage.Suspended) && block.timestamp > marketDeadline + RESOLUTION_GRACE_PERIOD) {
            stage = Stage.Expired;
            emit MarketCancelled("Auto-expired after grace period", "");
        }
        require(stage == Stage.Active, "PM: market not active");
    }

    /// @dev Check trading is allowed (only Active stage).
    function _assertTradingAllowed() internal {
        _assertActive();
    }

    function _trackParticipant(address user) internal {
        if (!_hasParticipated[user]) {
            _hasParticipated[user] = true;
            participantCount++;
        }
    }

    receive() external payable {}
}
