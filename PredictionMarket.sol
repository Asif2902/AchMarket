// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LMSRMath} from "./LMSRMath.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  PredictionMarket
/// @notice Self-contained prediction market with:
///           • N outcomes (binary YES/NO or multi-outcome)
///           • LMSR dynamic pricing (buy AND sell)
///           • Admin resolution with mandatory proof attachment
///           • Admin can resolve at any time before duration ends
///           • Auto-expiry after duration → full refunds
///           • Admin cancellation → full refunds
///
///         Deployed by PredictionMarketFactory with ALL market data
///         provided at creation — immediately Active on deploy.
///
contract PredictionMarket is ReentrancyGuard {
    using LMSRMath for int256;

    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/

    enum Stage {
        Active,     // trading open
        Resolved,   // winning outcome set, winners can redeem
        Cancelled,  // admin cancelled, everyone refunded
        Expired     // duration passed without resolution, everyone refunded
    }

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
    event MarketCancelled(string reason);
    event Redeemed(address indexed user, uint256 amountWei);
    event Refunded(address indexed user, uint256 amountWei);

    /*//////////////////////////////////////////////////////////////
                              STORAGE
    //////////////////////////////////////////////////////////////*/

    // ── Metadata (all set at creation, immediately active) ────────
    string  public title;
    string  public description;
    string  public category;
    string  public imageUri;
    uint256 public createdAt;

    // ── Outcomes ─────────────────────────────────────────────────
    string[] public outcomeLabels;        // e.g. ["Yes","No"] or ["A","B","Draw"]
    uint256  public outcomeCount;

    // ── Admin ─────────────────────────────────────────────────────
    address public admin;

    // ── LMSR ─────────────────────────────────────────────────────
    int256  public b;                     // liquidity parameter (WAD)
    int256[] public totalSharesWad;       // total shares per outcome (WAD)

    // ── User balances ─────────────────────────────────────────────
    // user => outcome index => shares held (WAD)
    mapping(address => mapping(uint256 => uint256)) public sharesOf;
    // user => total net ETH deposited (increases on buy, decreases on sell)
    mapping(address => uint256) public netDepositedWei;

    // ── Lifecycle ─────────────────────────────────────────────────
    Stage   public stage;
    uint256 public winningOutcome;        // valid only when stage == Resolved
    uint256 public marketDeadline;        // unix timestamp; market auto-expires after this
    string  public proofUri;             // admin-attached resolution proof

    // ── Analytics ─────────────────────────────────────────────────
    uint256 public totalVolumeWei;        // cumulative buy volume
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

    /*//////////////////////////////////////////////////////////////
                           CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice All market data is provided at creation.
    ///         The market is immediately Active — no separate activation step.
    ///
    /// @param _admin          Address authorised to resolve/cancel.
    /// @param _title          Market question.
    /// @param _description    Full description and resolution criteria.
    /// @param _category       Category tag (e.g. "Crypto", "Sports").
    /// @param _imageUri       Thumbnail/header image URI (IPFS or HTTPS).
    /// @param _outcomeLabels  Human-readable labels for each outcome.
    ///                        Pass ["Yes","No"] for a binary market.
    ///                        Pass ["Team A","Team B","Draw"] for 3 outcomes, etc.
    /// @param _bWad           LMSR liquidity parameter in WAD (e.g. 100e18).
    ///                        Rule of thumb: expected total volume / 10.
    /// @param _durationSeconds  How long (in seconds) the market is open.
    ///                          Admin can resolve before this; after it → auto-refund.
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
    ///
    /// @param  outcomeIdx  Index of the outcome to back (0-based).
    /// @param  sharesWad   Number of shares to purchase in WAD (1e18 = 1 share).
    /// @param  maxCostWei  Slippage guard — revert if cost exceeds this.
    function buy(
        uint256 outcomeIdx,
        uint256 sharesWad,
        uint256 maxCostWei
    )
        external
        payable
        nonReentrant
        onlyActive
    {
        require(outcomeIdx < outcomeCount, "PM: invalid outcome");
        require(sharesWad  > 0,           "PM: zero shares");

        int256[] memory q = _getSharesArray();
        int256 rawCost = LMSRMath.tradeCost(q, outcomeIdx, int256(sharesWad), b);
        require(rawCost > 0, "PM: unexpected non-positive buy cost");

        uint256 costWei = uint256(rawCost);
        require(costWei <= maxCostWei,  "PM: slippage exceeded");
        require(msg.value >= costWei,   "PM: insufficient ETH");

        // Update state
        totalSharesWad[outcomeIdx]         += int256(sharesWad);
        sharesOf[msg.sender][outcomeIdx]   += sharesWad;
        netDepositedWei[msg.sender]        += costWei;
        totalVolumeWei                     += costWei;
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
    ///         The LMSR guarantees a fair price; you always receive ETH back.
    ///
    /// @param  outcomeIdx     Index of the outcome to sell.
    /// @param  sharesWad      Number of shares to sell in WAD.
    /// @param  minReceiveWei  Slippage guard — revert if proceeds fall below this.
    function sell(
        uint256 outcomeIdx,
        uint256 sharesWad,
        uint256 minReceiveWei
    )
        external
        nonReentrant
        onlyActive
    {
        require(outcomeIdx < outcomeCount, "PM: invalid outcome");
        require(sharesWad  > 0,           "PM: zero shares");
        require(
            sharesOf[msg.sender][outcomeIdx] >= sharesWad,
            "PM: insufficient shares"
        );

        // Selling = negative delta in LMSR → negative cost → user receives ETH
        int256[] memory q        = _getSharesArray();
        int256   rawCost         = LMSRMath.tradeCost(q, outcomeIdx, -int256(sharesWad), b);
        require(rawCost < 0, "PM: unexpected non-negative sell cost");

        uint256 proceedsWei = uint256(-rawCost);
        require(proceedsWei >= minReceiveWei, "PM: slippage exceeded");
        require(address(this).balance >= proceedsWei, "PM: insufficient liquidity");

        // Update state
        totalSharesWad[outcomeIdx]          -= int256(sharesWad);
        sharesOf[msg.sender][outcomeIdx]    -= sharesWad;

        // Adjust net deposited (cap at zero to avoid underflow on profit)
        if (netDepositedWei[msg.sender] >= proceedsWei) {
            netDepositedWei[msg.sender] -= proceedsWei;
        } else {
            netDepositedWei[msg.sender] = 0;
        }

        (bool ok,) = msg.sender.call{value: proceedsWei}("");
        require(ok, "PM: sell transfer failed");

        emit SharesSold(msg.sender, outcomeIdx, sharesWad, proceedsWei);
    }

    /*//////////////////////////////////////////////////////////////
                           ADMIN: RESOLVE
    //////////////////////////////////////////////////////////////*/

    /// @notice Admin resolves the market at any time while it is Active.
    ///         Can be called before OR after the deadline — early resolution is fine.
    ///         A proof URI is mandatory for transparency.
    ///
    /// @param  _winningOutcome  Index of the winning outcome.
    /// @param  _proofUri        IPFS CID or HTTPS URL to resolution evidence.
    function resolve(uint256 _winningOutcome, string calldata _proofUri)
        external
        onlyAdmin
    {
        // Allow resolution even if deadline passed (admin just beats the expiry call)
        require(
            stage == Stage.Active || stage == Stage.Expired,
            "PM: already resolved or cancelled"
        );
        require(_winningOutcome < outcomeCount, "PM: invalid outcome index");
        require(bytes(_proofUri).length > 0,    "PM: proof URI required");

        winningOutcome = _winningOutcome;
        proofUri       = _proofUri;
        stage          = Stage.Resolved;

        emit MarketResolved(_winningOutcome, _proofUri);
    }

    /*//////////////////////////////////////////////////////////////
                           ADMIN: CANCEL
    //////////////////////////////////////////////////////////////*/

    /// @notice Admin cancels the market; all deposited ETH becomes refundable.
    function cancel(string calldata reason)
        external
        onlyAdmin
    {
        require(stage == Stage.Active, "PM: not active");
        stage = Stage.Cancelled;
        emit MarketCancelled(reason);
    }

    /*//////////////////////////////////////////////////////////////
                       EXPIRY (ANYONE CAN TRIGGER)
    //////////////////////////////////////////////////////////////*/

    /// @notice Anyone may call this after `marketDeadline` if the market
    ///         has not been resolved. Transitions to Expired → refunds open.
    function triggerExpiry() external {
        require(stage == Stage.Active,                  "PM: not active");
        require(block.timestamp > marketDeadline,       "PM: deadline not passed");
        stage = Stage.Expired;
        emit MarketCancelled("Expired: not resolved within duration");
    }

    /*//////////////////////////////////////////////////////////////
                          REDEEM  (WINNERS)
    //////////////////////////////////////////////////////////////*/

    /// @notice Winners redeem their shares for ETH after market is resolved.
    ///         Payout = (user winning shares / total winning shares) * contract balance.
    ///         This gives winners the full pot proportionally.
    function redeem() external nonReentrant {
        require(stage == Stage.Resolved, "PM: not resolved");
        require(!hasRedeemed[msg.sender], "PM: already redeemed");

        uint256 userWinShares   = sharesOf[msg.sender][winningOutcome];
        uint256 totalWinShares  = uint256(totalSharesWad[winningOutcome]);

        require(userWinShares  > 0, "PM: no winning shares");
        require(totalWinShares > 0, "PM: no total winning shares");

        hasRedeemed[msg.sender] = true;

        uint256 payout = (userWinShares * address(this).balance) / totalWinShares;

        (bool ok,) = msg.sender.call{value: payout}("");
        require(ok, "PM: payout failed");

        emit Redeemed(msg.sender, payout);
    }

    /*//////////////////////////////////////////////////////////////
                          REFUND (CANCELLED / EXPIRED)
    //////////////////////////////////////////////////////////////*/

    /// @notice Refund deposited ETH when the market is cancelled or expired.
    ///         Pro-rata refund based on user's net deposit vs total volume.
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
        uint256 payout = totalVolumeWei > 0
            ? (userDeposit * bal) / totalVolumeWei
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
            uint256          _participantCount
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
            participantCount
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

        // If no trades yet → uniform distribution
        bool anyTrades;
        for (uint256 i = 0; i < outcomeCount; ) {
            if (q[i] > 0) { anyTrades = true; break; }
            unchecked { i++; }
        }
        if (!anyTrades) {
            int256 uniform = int256(1e18 / int256(outcomeCount));
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
        costWei = uint256(raw);
    }

    /// @notice Preview proceeds (wei) from selling `sharesWad` of `outcomeIdx`.
    function previewSell(uint256 outcomeIdx, uint256 sharesWad)
        external view returns (uint256 proceedsWei)
    {
        require(outcomeIdx < outcomeCount, "PM: invalid outcome");
        int256[] memory q = _getSharesArray();
        int256 raw = LMSRMath.tradeCost(q, outcomeIdx, -int256(sharesWad), b);
        proceedsWei = uint256(-raw);
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

    /// @dev Check market is Active; auto-transition to Expired if deadline passed.
    function _assertActive() internal {
        if (stage == Stage.Active && block.timestamp > marketDeadline) {
            stage = Stage.Expired;
            emit MarketCancelled("Auto-expired");
        }
        require(stage == Stage.Active, "PM: market not active");
    }

    function _trackParticipant(address user) internal {
        if (!_hasParticipated[user]) {
            _hasParticipated[user] = true;
            participantCount++;
        }
    }

    receive() external payable {}
}
