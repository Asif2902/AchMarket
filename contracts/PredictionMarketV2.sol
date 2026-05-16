// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LMSRMath} from "./LMSRMath.sol";

/// @title PredictionMarketV2
/// @notice Hybrid market with a CLOB and LMSR instant liquidity.
contract PredictionMarketV2 is ReentrancyGuard {
    enum Stage {
        Active,
        Suspended,
        Resolved,
        Cancelled,
        Expired
    }

    enum MarketMode {
        CLOB_ONLY,
        HYBRID_CLOB_MM
    }

    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant DEFAULT_MM_SPREAD_BPS = 100;
    uint256 public constant MAX_MM_SPREAD_BPS = 2_000;
    uint256 public constant RESOLUTION_GRACE_PERIOD = 3 days;
    uint256 public constant MAX_LMSR_SHARES_WAD = 1_000_000_000e18;

    address private _owner;
    bool private _initialized;

    string public title;
    string public description;
    string public category;
    string public imageUri;
    uint256 public createdAt;

    string[] public outcomeLabels;
    uint256 public outcomeCount;

    MarketMode public marketMode;
    /// @dev LMSR liquidity parameter for HYBRID_CLOB_MM markets.
    int256 public b;
    int256[] public totalSharesWad;
    uint256[] public lastTradePriceWad;

    mapping(address => mapping(uint256 => uint256)) public sharesOf;
    mapping(address => bool) public authorizedOperator;
    mapping(address => bool) public hasRedeemed;
    mapping(address => bool) public hasParticipated;

    Stage public stage;
    uint256 public winningOutcome;
    uint256 public marketDeadline;
    uint256 public resolutionTime;
    string public proofUri;
    string public cancelReason;
    string public cancelProofUri;
    string public resolutionSource;
    string public fallbackResolutionSource;
    string public invalidCondition;
    address public resolutionManager;

    uint256 public initialLiquidityWei;
    uint256 public marketPoolWei;
    uint256 public feePoolWei;
    uint256 public resolvedPoolWei;
    uint256 public totalClaimWei;
    uint256 public totalVolumeWei;
    uint256 public participantCount;
    uint256 public totalWinningSharesAtResolution;
    uint256 public totalClaimSharesAtResolution;
    uint256 public remainingClaimSharesWad;
    uint256 public payoutPerWinningShareWad;
    uint256 public payoutPerInvalidShareWad;
    uint256 public totalClaimedWei;
    uint256 public mmSpreadBps;

    event ResolutionManagerUpdated(address indexed resolutionManager);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MarketInitialized(
        address indexed owner,
        address indexed resolutionManager,
        uint256 outcomeCount,
        MarketMode mode,
        int256 initialMmSharesWad,
        uint256 initialLiquidityWei,
        uint256 marketDeadline,
        uint256 resolutionTime
    );
    event ResolutionRulesUpdated(
        string resolutionSource,
        uint256 resolutionTime,
        string fallbackResolutionSource,
        string invalidCondition
    );
    event OperatorUpdated(address indexed operator, bool allowed);
    event MMSpreadUpdated(uint256 spreadBps);
    event SharesBought(address indexed trader, uint256 indexed outcomeIndex, uint256 sharesWad, uint256 costWei);
    event SharesSold(address indexed trader, uint256 indexed outcomeIndex, uint256 sharesWad, uint256 proceedsWei);
    event SharesMoved(address indexed from, address indexed to, uint256 indexed outcomeIndex, uint256 sharesWad);
    event TradePriceRecorded(uint256 indexed outcomeIndex, uint256 priceWad);
    event MarketResolved(uint256 winningOutcome, string proofUri);
    event MarketCancelled(string reason, string proofUri);
    event MarketEdited(string newTitle, string newDescription, string newCategory);
    event MarketSuspended();
    event MarketResumed();
    event DeadlineEdited(uint256 newDeadline);
    event Redeemed(address indexed user, uint256 amountWei);
    event DustSwept(address indexed recipient, uint256 amountWei);
    event FeeSwept(address indexed recipient, uint256 amountWei);

    modifier onlyOperator() {
        require(authorizedOperator[msg.sender], "M");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == _owner, "M");
        _;
    }

    modifier onlyEditable() {
        require(
            (stage == Stage.Active || stage == Stage.Suspended) && block.timestamp <= marketDeadline,
            "M"
        );
        _;
    }

    modifier onlyResolutionManager() {
        require(msg.sender == resolutionManager, "M");
        _;
    }

    constructor() {
        _initialized = true;
    }

    function initialize(
        address owner_,
        string memory _title,
        string memory _description,
        string memory _category,
        string memory _imageUri,
        string[] memory _outcomeLabels,
        MarketMode _marketMode,
        int256 _initialMmSharesWad,
        uint256 _durationSeconds,
        string memory _resolutionSource,
        uint256 _resolutionTime,
        string memory _fallbackResolutionSource,
        string memory _invalidCondition,
        address _resolutionManager,
        address[] memory _operators
    ) external payable {
        require(!_initialized, "M");
        _initialized = true;
        require(owner_ != address(0), "M");
        require(_resolutionManager != address(0), "M");
        require(_outcomeLabels.length >= 2, "M");
        require(uint8(_marketMode) <= uint8(MarketMode.HYBRID_CLOB_MM), "M");
        if (_marketMode == MarketMode.CLOB_ONLY) {
            require(_initialMmSharesWad == 0, "M");
        } else {
            require(_initialMmSharesWad > 0, "M");
            require(
                msg.value >= uint256(LMSRMath.initialLiquidity(_outcomeLabels.length, _initialMmSharesWad)),
                "M"
            );
        }
        require(_durationSeconds >= 1 hours, "M");
        require(bytes(_resolutionSource).length > 0, "M");
        require(bytes(_fallbackResolutionSource).length > 0, "M");
        require(bytes(_invalidCondition).length > 0, "M");
        require(_resolutionTime >= block.timestamp + _durationSeconds, "M");

        _transferOwnership(owner_);
        title = _title;
        description = _description;
        category = _category;
        imageUri = _imageUri;
        marketMode = _marketMode;
        b = _initialMmSharesWad;
        createdAt = block.timestamp;
        marketDeadline = block.timestamp + _durationSeconds;
        resolutionTime = _resolutionTime;
        resolutionSource = _resolutionSource;
        fallbackResolutionSource = _fallbackResolutionSource;
        invalidCondition = _invalidCondition;
        resolutionManager = _resolutionManager;
        stage = Stage.Active;
        initialLiquidityWei = msg.value;
        marketPoolWei = msg.value;
        mmSpreadBps = DEFAULT_MM_SPREAD_BPS;

        outcomeCount = _outcomeLabels.length;
        uint256 initialPrice = WAD / _outcomeLabels.length;
        for (uint256 i = 0; i < _outcomeLabels.length; ) {
            outcomeLabels.push(_outcomeLabels[i]);
            totalSharesWad.push(0);
            lastTradePriceWad.push(initialPrice);
            unchecked { i++; }
        }

        for (uint256 i = 0; i < _operators.length; ) {
            require(_operators[i] != address(0), "M");
            authorizedOperator[_operators[i]] = true;
            emit OperatorUpdated(_operators[i], true);
            unchecked { i++; }
        }

        emit MarketInitialized(
            owner_,
            _resolutionManager,
            outcomeCount,
            _marketMode,
            _initialMmSharesWad,
            msg.value,
            marketDeadline,
            _resolutionTime
        );
    }

    function owner() public view returns (address) {
        return _owner;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "M");
        _transferOwnership(newOwner);
    }

    function setAuthorizedOperator(address operator, bool allowed) external onlyOwner {
        require(operator != address(0), "M");
        authorizedOperator[operator] = allowed;
        emit OperatorUpdated(operator, allowed);
    }

    function setResolutionManager(address _resolutionManager) external onlyOwner {
        require(_resolutionManager != address(0), "M");
        resolutionManager = _resolutionManager;
        emit ResolutionManagerUpdated(_resolutionManager);
    }

    function setMMSpreadBps(uint256 _mmSpreadBps) external onlyOwner {
        require(_mmSpreadBps <= MAX_MM_SPREAD_BPS, "M");
        mmSpreadBps = _mmSpreadBps;
        emit MMSpreadUpdated(_mmSpreadBps);
    }

    function editResolutionRules(
        string calldata _resolutionSource,
        uint256 _resolutionTime,
        string calldata _fallbackResolutionSource,
        string calldata _invalidCondition
    ) external onlyOwner onlyEditable {
        require(bytes(_resolutionSource).length > 0, "M");
        require(bytes(_fallbackResolutionSource).length > 0, "M");
        require(bytes(_invalidCondition).length > 0, "M");
        require(_resolutionTime >= marketDeadline, "M");
        resolutionSource = _resolutionSource;
        resolutionTime = _resolutionTime;
        fallbackResolutionSource = _fallbackResolutionSource;
        invalidCondition = _invalidCondition;
        emit ResolutionRulesUpdated(_resolutionSource, _resolutionTime, _fallbackResolutionSource, _invalidCondition);
    }

    function buyFor(address trader, uint256 outcomeIdx, uint256 sharesWad, uint256 maxCostWei)
        external
        payable
        nonReentrant
        onlyOperator
        returns (uint256 costWei)
    {
        _assertTradingAllowed();
        require(marketMode == MarketMode.HYBRID_CLOB_MM, "M");
        require(trader != address(0), "M");
        require(outcomeIdx < outcomeCount, "M");
        require(sharesWad > 0, "M");

        costWei = _quoteBuy(outcomeIdx, sharesWad);
        require(costWei > 0, "M");
        require(costWei <= maxCostWei, "M");
        require(msg.value >= costWei, "M");

        totalSharesWad[outcomeIdx] += int256(sharesWad);
        sharesOf[trader][outcomeIdx] += sharesWad;
        marketPoolWei += costWei;
        totalVolumeWei += costWei;
        _trackParticipant(trader);
        _recordTradePrice(outcomeIdx, (costWei * WAD) / sharesWad);

        uint256 excess = msg.value - costWei;
        if (excess > 0) _sendValue(payable(msg.sender), excess, "M");

        emit SharesBought(trader, outcomeIdx, sharesWad, costWei);
    }

    function sellFrom(
        address trader,
        uint256 outcomeIdx,
        uint256 sharesWad,
        uint256 minReceiveWei,
        address payable recipient
    )
        external
        nonReentrant
        onlyOperator
        returns (uint256 proceedsWei)
    {
        _assertTradingAllowed();
        require(marketMode == MarketMode.HYBRID_CLOB_MM, "M");
        require(trader != address(0), "M");
        require(recipient != address(0), "M");
        require(outcomeIdx < outcomeCount, "M");
        require(sharesWad > 0, "M");
        require(sharesOf[trader][outcomeIdx] >= sharesWad, "M");

        proceedsWei = _quoteSell(outcomeIdx, sharesWad);
        require(proceedsWei > 0, "M");
        require(proceedsWei >= minReceiveWei, "M");
        require(address(this).balance >= feePoolWei + proceedsWei, "M");
        require(marketPoolWei >= proceedsWei, "M");

        sharesOf[trader][outcomeIdx] -= sharesWad;
        totalSharesWad[outcomeIdx] -= int256(sharesWad);
        marketPoolWei -= proceedsWei;
        totalVolumeWei += proceedsWei;
        _recordTradePrice(outcomeIdx, (proceedsWei * WAD) / sharesWad);

        _sendValue(recipient, proceedsWei, "M");

        emit SharesSold(trader, outcomeIdx, sharesWad, proceedsWei);
    }

    function moveShares(address from, address to, uint256 outcomeIdx, uint256 sharesWad)
        external
        onlyOperator
        returns (bool)
    {
        require(from != address(0) && to != address(0), "M");
        require(outcomeIdx < outcomeCount, "M");
        require(sharesWad > 0, "M");
        require(sharesOf[from][outcomeIdx] >= sharesWad, "M");

        sharesOf[from][outcomeIdx] -= sharesWad;
        sharesOf[to][outcomeIdx] += sharesWad;
        _trackParticipant(to);

        emit SharesMoved(from, to, outcomeIdx, sharesWad);
        return true;
    }

    function recordTradePrice(uint256 outcomeIdx, uint256 priceWad) external onlyOperator returns (bool) {
        require(outcomeIdx < outcomeCount, "M");
        require(priceWad > 0 && priceWad <= WAD, "M");
        _recordTradePrice(outcomeIdx, priceWad);
        return true;
    }

    function resolveByManager(uint256 _winningOutcome, string calldata _proofUri, address)
        external
        onlyResolutionManager
    {
        require(stage == Stage.Active || stage == Stage.Suspended, "M");
        require(_winningOutcome < outcomeCount, "M");
        require(bytes(_proofUri).length > 0, "M");

        winningOutcome = _winningOutcome;
        proofUri = _proofUri;
        stage = Stage.Resolved;
        _finalizeResolved(_winningOutcome);

        emit MarketResolved(_winningOutcome, _proofUri);
    }

    function cancelByManager(string calldata reason, string calldata _proofUri, address)
        external
        onlyResolutionManager
    {
        require(stage == Stage.Active || stage == Stage.Suspended, "M");
        require(bytes(reason).length > 0, "M");
        require(bytes(_proofUri).length > 0, "M");

        cancelReason = reason;
        cancelProofUri = _proofUri;
        stage = Stage.Cancelled;
        _finalizeInvalid();

        emit MarketCancelled(reason, _proofUri);
    }

    function emergencyCancel(string calldata reason, string calldata _proofUri) external onlyOwner {
        require(stage == Stage.Active || stage == Stage.Suspended, "M");
        require(bytes(reason).length > 0, "M");
        require(bytes(_proofUri).length > 0, "M");

        cancelReason = reason;
        cancelProofUri = _proofUri;
        stage = Stage.Cancelled;
        _finalizeInvalid();

        emit MarketCancelled(reason, _proofUri);
    }

    function triggerExpiry() external {
        require(stage == Stage.Active || stage == Stage.Suspended, "M");
        require(block.timestamp > resolutionTime + RESOLUTION_GRACE_PERIOD, "M");
        _expire("Expired: not resolved within grace period", "");
    }

    function redeem() external nonReentrant {
        require(
            stage == Stage.Resolved || stage == Stage.Cancelled || stage == Stage.Expired,
            "M"
        );
        require(!hasRedeemed[msg.sender], "M");

        uint256 payout;
        uint256 claimShares;
        if (stage == Stage.Resolved) {
            claimShares = sharesOf[msg.sender][winningOutcome];
            require(claimShares > 0, "M");
            payout = (claimShares * payoutPerWinningShareWad) / WAD;
            sharesOf[msg.sender][winningOutcome] = 0;
            totalSharesWad[winningOutcome] -= int256(claimShares);
        } else {
            for (uint256 i = 0; i < outcomeCount; ) {
                uint256 bal = sharesOf[msg.sender][i];
                if (bal > 0) {
                    claimShares += bal;
                    sharesOf[msg.sender][i] = 0;
                    totalSharesWad[i] -= int256(bal);
                }
                unchecked { i++; }
            }
            require(claimShares > 0, "M");
            payout = (claimShares * payoutPerInvalidShareWad) / WAD;
        }

        require(payout > 0, "M");
        require(address(this).balance >= feePoolWei + payout, "M");
        hasRedeemed[msg.sender] = true;
        if (remainingClaimSharesWad >= claimShares) {
            remainingClaimSharesWad -= claimShares;
        } else {
            remainingClaimSharesWad = 0;
        }
        totalClaimedWei += payout;
        if (marketPoolWei >= payout) {
            marketPoolWei -= payout;
        } else {
            marketPoolWei = 0;
        }

        _sendValue(payable(msg.sender), payout, "M");
        emit Redeemed(msg.sender, payout);
    }

    function editMarket(
        string calldata _title,
        string calldata _description,
        string calldata _category
    ) external onlyOwner onlyEditable {
        require(bytes(_title).length > 0, "M");
        require(bytes(_description).length > 0, "M");
        require(bytes(_category).length > 0, "M");
        title = _title;
        description = _description;
        category = _category;
        emit MarketEdited(_title, _description, _category);
    }

    function suspend() external onlyOwner {
        require(stage == Stage.Active, "M");
        stage = Stage.Suspended;
        emit MarketSuspended();
    }

    function resume() external onlyOwner {
        require(stage == Stage.Suspended, "M");
        stage = Stage.Active;
        emit MarketResumed();
    }

    function editDeadline(uint256 newDeadline) external onlyOwner onlyEditable {
        require(newDeadline > block.timestamp, "M");
        require(newDeadline <= resolutionTime, "M");
        marketDeadline = newDeadline;
        emit DeadlineEdited(newDeadline);
    }

    function sweepDust(address payable recipient) external onlyOwner nonReentrant {
        require(stage == Stage.Resolved || stage == Stage.Cancelled || stage == Stage.Expired, "M");
        require(remainingClaimSharesWad == 0, "M");
        require(recipient != address(0), "M");
        uint256 sweepable = address(this).balance > feePoolWei ? address(this).balance - feePoolWei : 0;
        require(sweepable > 0, "M");
        if (marketPoolWei >= sweepable) {
            marketPoolWei -= sweepable;
        } else {
            marketPoolWei = 0;
        }
        _sendValue(recipient, sweepable, "M");
        emit DustSwept(recipient, sweepable);
    }

    function sweepFees(address payable recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "M");
        uint256 amount = feePoolWei;
        require(amount > 0, "M");
        feePoolWei = 0;
        _sendValue(recipient, amount, "M");
        emit FeeSwept(recipient, amount);
    }

    function getMarketInfo()
        external
        view
        returns (
            string memory _title,
            string memory _description,
            string memory _category,
            string memory _imageUri,
            string memory _proofUri,
            string[] memory _outcomeLabels,
            Stage _stage,
            uint256 _winningOutcome,
            uint256 _createdAt,
            uint256 _marketDeadline,
            uint256 _totalVolumeWei,
            uint256 _participantCount,
            string memory _cancelReason,
            string memory _cancelProofUri
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

    function getShares() external view returns (int256[] memory) {
        return totalSharesWad;
    }

    function getResolutionRules()
        external
        view
        returns (
            string memory _resolutionSource,
            uint256 _resolutionTime,
            string memory _fallbackResolutionSource,
            string memory _invalidCondition,
            address _resolutionManager
        )
    {
        return (
            resolutionSource,
            resolutionTime,
            fallbackResolutionSource,
            invalidCondition,
            resolutionManager
        );
    }

    function getImpliedProbabilities() external view returns (int256[] memory probs) {
        probs = new int256[](outcomeCount);
        if (marketMode == MarketMode.HYBRID_CLOB_MM) {
            int256[] memory q = _getSharesArray();
            for (uint256 i = 0; i < outcomeCount; ) {
                probs[i] = LMSRMath.impliedProbability(q, i, b);
                unchecked { i++; }
            }
            return probs;
        }

        for (uint256 i = 0; i < outcomeCount; ) {
            probs[i] = int256(lastTradePriceWad[i]);
            unchecked { i++; }
        }
    }

    function getImpliedProbability(uint256 outcomeIdx) public view returns (uint256) {
        require(outcomeIdx < outcomeCount, "M");
        if (marketMode == MarketMode.HYBRID_CLOB_MM) {
            int256 prob = LMSRMath.impliedProbability(_getSharesArray(), outcomeIdx, b);
            return prob > 0 ? uint256(prob) : 0;
        }
        return lastTradePriceWad[outcomeIdx];
    }

    function previewBuy(uint256 outcomeIdx, uint256 sharesWad) public view returns (uint256 costWei) {
        require(outcomeIdx < outcomeCount, "M");
        if (marketMode != MarketMode.HYBRID_CLOB_MM || sharesWad == 0) return 0;
        return _quoteBuy(outcomeIdx, sharesWad);
    }

    function previewSell(uint256 outcomeIdx, uint256 sharesWad) public view returns (uint256 proceedsWei) {
        require(outcomeIdx < outcomeCount, "M");
        if (marketMode != MarketMode.HYBRID_CLOB_MM || sharesWad == 0) return 0;
        return _quoteSell(outcomeIdx, sharesWad);
    }

    function previewMMBuyFromState(uint256 outcomeIdx, uint256 soldSharesWad, uint256 sharesWad)
        external
        view
        returns (uint256)
    {
        require(outcomeIdx < outcomeCount, "M");
        if (marketMode != MarketMode.HYBRID_CLOB_MM || sharesWad == 0) return 0;
        int256[] memory q = _getSharesArray();
        q[outcomeIdx] = int256(soldSharesWad);
        return _quoteBuyFromState(q, outcomeIdx, sharesWad);
    }

    function previewMMSellFromState(
        uint256 outcomeIdx,
        uint256 soldSharesWad,
        uint256 reserveWei,
        uint256 sharesWad
    ) external view returns (uint256) {
        require(outcomeIdx < outcomeCount, "M");
        if (marketMode != MarketMode.HYBRID_CLOB_MM || sharesWad == 0) return 0;
        int256[] memory q = _getSharesArray();
        q[outcomeIdx] = int256(soldSharesWad);
        return _quoteSellFromState(q, outcomeIdx, reserveWei, sharesWad);
    }

    function getMMOutcomeState(uint256 outcomeIdx)
        external
        view
        returns (
            uint256 initialSharesWad,
            uint256 availableSharesWad,
            uint256 soldSharesWad,
            uint256 reserveWei,
            uint256 bidPriceWad,
            uint256 askPriceWad
        )
    {
        require(outcomeIdx < outcomeCount, "M");
        if (marketMode != MarketMode.HYBRID_CLOB_MM) return (0, 0, 0, 0, 0, 0);
        uint256 outstanding = _positiveOutcomeShares(outcomeIdx);
        initialSharesWad = MAX_LMSR_SHARES_WAD;
        soldSharesWad = outstanding;
        reserveWei = _claimablePool();
        availableSharesWad = MAX_LMSR_SHARES_WAD > outstanding
            ? MAX_LMSR_SHARES_WAD - outstanding
            : 0;
        askPriceWad = availableSharesWad > 0 ? previewBuy(outcomeIdx, WAD) : 0;
        if (soldSharesWad > 0 && reserveWei > 0) {
            uint256 sampleShares = soldSharesWad < WAD ? soldSharesWad : WAD;
            uint256 proceeds = _quoteSell(outcomeIdx, sampleShares);
            bidPriceWad = proceeds > 0 ? (proceeds * WAD) / sampleShares : 0;
        }
    }

    function getUserInfo(address user)
        external
        view
        returns (
            uint256[] memory _shares,
            bool _redeemed,
            bool _canRedeem
        )
    {
        _shares = new uint256[](outcomeCount);
        uint256 anyShares;
        for (uint256 i = 0; i < outcomeCount; ) {
            _shares[i] = sharesOf[user][i];
            anyShares += _shares[i];
            unchecked { i++; }
        }
        _redeemed = hasRedeemed[user];
        if (stage == Stage.Resolved) {
            _canRedeem = !_redeemed && sharesOf[user][winningOutcome] > 0;
        } else if (stage == Stage.Cancelled || stage == Stage.Expired) {
            _canRedeem = !_redeemed && anyShares > 0;
        }
    }

    function resolutionDeadline() external view returns (uint256) {
        return resolutionTime + RESOLUTION_GRACE_PERIOD;
    }

    function isTradingOpen() public view returns (bool) {
        return stage == Stage.Active && block.timestamp <= marketDeadline;
    }

    function _assertTradingAllowed() internal view {
        require(isTradingOpen(), "M");
    }

    function _finalizeResolved(uint256 _winningOutcome) internal {
        uint256 claimablePool = _claimablePool();
        uint256 winningShares = uint256(totalSharesWad[_winningOutcome]);
        resolvedPoolWei = claimablePool;
        totalClaimWei = winningShares <= claimablePool ? winningShares : claimablePool;
        totalWinningSharesAtResolution = winningShares;
        totalClaimSharesAtResolution = winningShares;
        remainingClaimSharesWad = winningShares;
        payoutPerWinningShareWad = winningShares == 0 ? 0 : (totalClaimWei * WAD) / winningShares;
    }

    function _finalizeInvalid() internal {
        uint256 claimablePool = _claimablePool();
        uint256 claimShares = _totalOutstandingShares();
        resolvedPoolWei = claimablePool;
        totalClaimWei = claimablePool;
        totalClaimSharesAtResolution = claimShares;
        remainingClaimSharesWad = claimShares;
        payoutPerInvalidShareWad = claimShares == 0 ? 0 : (claimablePool * WAD) / claimShares;
    }

    function _expire(string memory reason, string memory proof) internal {
        cancelReason = reason;
        cancelProofUri = proof;
        stage = Stage.Expired;
        _finalizeInvalid();
        emit MarketCancelled(reason, proof);
    }

    function _claimablePool() internal view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > feePoolWei ? bal - feePoolWei : 0;
    }

    function _totalOutstandingShares() internal view returns (uint256 total) {
        for (uint256 i = 0; i < outcomeCount; ) {
            if (totalSharesWad[i] > 0) total += uint256(totalSharesWad[i]);
            unchecked { i++; }
        }
    }

    function _quoteBuy(uint256 outcomeIdx, uint256 sharesWad)
        internal
        view
        returns (uint256)
    {
        return _quoteBuyFromState(_getSharesArray(), outcomeIdx, sharesWad);
    }

    function _quoteSell(uint256 outcomeIdx, uint256 sharesWad)
        internal
        view
        returns (uint256)
    {
        return _quoteSellFromState(_getSharesArray(), outcomeIdx, _claimablePool(), sharesWad);
    }

    function _quoteBuyFromState(int256[] memory q, uint256 outcomeIdx, uint256 sharesWad)
        internal
        view
        returns (uint256)
    {
        if (sharesWad == 0) return 0;
        int256 rawCost = LMSRMath.tradeCost(q, outcomeIdx, int256(sharesWad), b);
        if (rawCost <= 0) return 0;
        return _applyAskSpreadToAmount(uint256(rawCost));
    }

    function _quoteSellFromState(
        int256[] memory q,
        uint256 outcomeIdx,
        uint256 reserveWei,
        uint256 sharesWad
    )
        internal
        view
        returns (uint256)
    {
        if (sharesWad == 0 || reserveWei == 0) return 0;
        if (q[outcomeIdx] < int256(sharesWad)) return 0;
        int256 rawCost = LMSRMath.tradeCost(q, outcomeIdx, -int256(sharesWad), b);
        if (rawCost >= 0) return 0;
        uint256 proceedsWei = _applyBidSpreadToAmount(uint256(-rawCost));
        if (proceedsWei == 0 || proceedsWei > reserveWei) return 0;
        return proceedsWei;
    }

    function _applyAskSpreadToAmount(uint256 amountWei) internal view returns (uint256) {
        return (amountWei * (MAX_BPS + mmSpreadBps)) / MAX_BPS;
    }

    function _applyBidSpreadToAmount(uint256 amountWei) internal view returns (uint256) {
        return (amountWei * (MAX_BPS - mmSpreadBps)) / MAX_BPS;
    }

    function _positiveOutcomeShares(uint256 outcomeIdx) internal view returns (uint256) {
        int256 shares = totalSharesWad[outcomeIdx];
        return shares > 0 ? uint256(shares) : 0;
    }

    function _getSharesArray() internal view returns (int256[] memory q) {
        q = new int256[](outcomeCount);
        for (uint256 i = 0; i < outcomeCount; ) {
            q[i] = totalSharesWad[i];
            unchecked { i++; }
        }
    }

    function _recordTradePrice(uint256 outcomeIdx, uint256 priceWad) internal {
        lastTradePriceWad[outcomeIdx] = priceWad;
        emit TradePriceRecorded(outcomeIdx, priceWad);
    }

    function _trackParticipant(address user) internal {
        if (!hasParticipated[user]) {
            hasParticipated[user] = true;
            participantCount++;
        }
    }

    function _transferOwnership(address newOwner) internal {
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }

    function _sendValue(address payable to, uint256 amount, string memory errorMessage) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, errorMessage);
    }

    receive() external payable {
        marketPoolWei += msg.value;
    }
}
