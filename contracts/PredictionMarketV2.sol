// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LMSRMath} from "./LMSRMath.sol";

/// @title PredictionMarketV2
/// @notice Solvent LMSR market designed to be executed through MarketRouter and HybridOrderBook.
contract PredictionMarketV2 is ReentrancyGuard {
    enum Stage {
        Active,
        Suspended,
        Resolved,
        Cancelled,
        Expired
    }

    uint256 public constant PLATFORM_FEE_BPS = 75;
    uint256 public constant RESOLVER_REWARD_BPS = 25;
    uint256 public constant RESOLUTION_GRACE_PERIOD = 3 days;

    address private _owner;
    bool private _initialized;

    string public title;
    string public description;
    string public category;
    string public imageUri;
    uint256 public createdAt;

    string[] public outcomeLabels;
    uint256 public outcomeCount;

    int256 public b;
    int256[] public totalSharesWad;

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
    uint256 public resolvedPoolWei;
    uint256 public totalClaimWei;
    uint256 public totalVolumeWei;
    uint256 public participantCount;

    event ResolutionManagerUpdated(address indexed resolutionManager);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MarketInitialized(
        address indexed owner,
        address indexed resolutionManager,
        uint256 outcomeCount,
        int256 bWad,
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
    event SharesBought(address indexed trader, uint256 indexed outcomeIndex, uint256 sharesWad, uint256 costWei);
    event SharesSold(address indexed trader, uint256 indexed outcomeIndex, uint256 sharesWad, uint256 proceedsWei);
    event SharesMoved(address indexed from, address indexed to, uint256 indexed outcomeIndex, uint256 sharesWad);
    event MarketResolved(uint256 winningOutcome, string proofUri);
    event MarketCancelled(string reason, string proofUri);
    event MarketEdited(string newTitle, string newDescription, string newCategory);
    event MarketSuspended();
    event MarketResumed();
    event DeadlineEdited(uint256 newDeadline);
    event Redeemed(address indexed user, uint256 amountWei);
    event FeeCollected(address indexed recipient, uint256 amountWei);
    event ResolverRewardPaid(address indexed recipient, uint256 amountWei);

    modifier onlyOperator() {
        require(authorizedOperator[msg.sender], "PMV2: not operator");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == _owner, "PMV2: not owner");
        _;
    }

    modifier onlyEditable() {
        require(
            (stage == Stage.Active || stage == Stage.Suspended) && block.timestamp <= marketDeadline,
            "PMV2: market not editable"
        );
        _;
    }

    modifier onlyResolutionManager() {
        require(msg.sender == resolutionManager, "PMV2: not resolver");
        _;
    }

    constructor() {
        _initialized = true;
    }

    function initialize(
        address _owner,
        string memory _title,
        string memory _description,
        string memory _category,
        string memory _imageUri,
        string[] memory _outcomeLabels,
        int256 _bWad,
        uint256 _durationSeconds,
        string memory _resolutionSource,
        uint256 _resolutionTime,
        string memory _fallbackResolutionSource,
        string memory _invalidCondition,
        address _resolutionManager,
        address[] memory _operators
    ) external payable {
        require(!_initialized, "PMV2: initialized");
        _initialized = true;
        require(_owner != address(0), "PMV2: zero owner");
        require(_resolutionManager != address(0), "PMV2: zero resolver");
        require(_bWad > 0, "PMV2: b must be > 0");
        require(_outcomeLabels.length >= 2, "PMV2: need outcomes");
        require(_durationSeconds >= 1 hours, "PMV2: duration too short");
        require(bytes(_resolutionSource).length > 0, "PMV2: source required");
        require(bytes(_fallbackResolutionSource).length > 0, "PMV2: fallback required");
        require(bytes(_invalidCondition).length > 0, "PMV2: invalid condition required");
        require(_resolutionTime >= block.timestamp + _durationSeconds, "PMV2: bad resolution time");

        uint256 requiredSeed = uint256(LMSRMath.initialLiquidity(_outcomeLabels.length, _bWad));
        require(msg.value >= requiredSeed, "PMV2: insufficient seed");

        _transferOwnership(_owner);
        title = _title;
        description = _description;
        category = _category;
        imageUri = _imageUri;
        b = _bWad;
        createdAt = block.timestamp;
        marketDeadline = block.timestamp + _durationSeconds;
        resolutionTime = _resolutionTime;
        resolutionSource = _resolutionSource;
        fallbackResolutionSource = _fallbackResolutionSource;
        invalidCondition = _invalidCondition;
        resolutionManager = _resolutionManager;
        stage = Stage.Active;
        initialLiquidityWei = msg.value;

        outcomeCount = _outcomeLabels.length;
        for (uint256 i = 0; i < _outcomeLabels.length; ) {
            outcomeLabels.push(_outcomeLabels[i]);
            totalSharesWad.push(0);
            unchecked { i++; }
        }

        for (uint256 i = 0; i < _operators.length; ) {
            require(_operators[i] != address(0), "PMV2: zero operator");
            authorizedOperator[_operators[i]] = true;
            emit OperatorUpdated(_operators[i], true);
            unchecked { i++; }
        }

        emit MarketInitialized(_owner, _resolutionManager, outcomeCount, _bWad, marketDeadline, _resolutionTime);
    }

    function owner() public view returns (address) {
        return _owner;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PMV2: zero owner");
        _transferOwnership(newOwner);
    }

    function setAuthorizedOperator(address operator, bool allowed) external onlyOwner {
        require(operator != address(0), "PMV2: zero operator");
        authorizedOperator[operator] = allowed;
        emit OperatorUpdated(operator, allowed);
    }

    function setResolutionManager(address _resolutionManager) external onlyOwner {
        require(_resolutionManager != address(0), "PMV2: zero resolver");
        resolutionManager = _resolutionManager;
        emit ResolutionManagerUpdated(_resolutionManager);
    }

    function editResolutionRules(
        string calldata _resolutionSource,
        uint256 _resolutionTime,
        string calldata _fallbackResolutionSource,
        string calldata _invalidCondition
    ) external onlyOwner onlyEditable {
        require(bytes(_resolutionSource).length > 0, "PMV2: source required");
        require(bytes(_fallbackResolutionSource).length > 0, "PMV2: fallback required");
        require(bytes(_invalidCondition).length > 0, "PMV2: invalid condition required");
        require(_resolutionTime >= marketDeadline, "PMV2: bad resolution time");
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
        require(trader != address(0), "PMV2: zero trader");
        require(outcomeIdx < outcomeCount, "PMV2: invalid outcome");
        require(sharesWad > 0, "PMV2: zero shares");

        int256[] memory q = _getSharesArray();
        int256 rawCost = LMSRMath.tradeCost(q, outcomeIdx, int256(sharesWad), b);
        require(rawCost >= 0, "PMV2: negative buy cost");

        costWei = uint256(rawCost);
        require(costWei <= maxCostWei, "PMV2: slippage exceeded");
        require(msg.value >= costWei, "PMV2: insufficient value");

        totalSharesWad[outcomeIdx] += int256(sharesWad);
        sharesOf[trader][outcomeIdx] += sharesWad;
        totalVolumeWei += costWei;
        _trackParticipant(trader);

        uint256 excess = msg.value - costWei;
        if (excess > 0) _sendValue(payable(msg.sender), excess, "PMV2: refund failed");

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
        require(trader != address(0), "PMV2: zero trader");
        require(recipient != address(0), "PMV2: zero recipient");
        require(outcomeIdx < outcomeCount, "PMV2: invalid outcome");
        require(sharesWad > 0, "PMV2: zero shares");
        require(sharesOf[trader][outcomeIdx] >= sharesWad, "PMV2: insufficient shares");

        int256[] memory q = _getSharesArray();
        int256 rawCost = LMSRMath.tradeCost(q, outcomeIdx, -int256(sharesWad), b);
        require(rawCost <= 0, "PMV2: positive sell cost");

        proceedsWei = rawCost < 0 ? uint256(-rawCost) : 0;
        require(proceedsWei >= minReceiveWei, "PMV2: slippage exceeded");
        require(address(this).balance >= proceedsWei, "PMV2: insufficient liquidity");

        totalSharesWad[outcomeIdx] -= int256(sharesWad);
        sharesOf[trader][outcomeIdx] -= sharesWad;
        totalVolumeWei += proceedsWei;

        if (proceedsWei > 0) _sendValue(recipient, proceedsWei, "PMV2: sell transfer failed");

        emit SharesSold(trader, outcomeIdx, sharesWad, proceedsWei);
    }

    function moveShares(address from, address to, uint256 outcomeIdx, uint256 sharesWad)
        external
        onlyOperator
        returns (bool)
    {
        require(from != address(0) && to != address(0), "PMV2: zero address");
        require(outcomeIdx < outcomeCount, "PMV2: invalid outcome");
        require(sharesWad > 0, "PMV2: zero shares");
        require(sharesOf[from][outcomeIdx] >= sharesWad, "PMV2: insufficient shares");

        sharesOf[from][outcomeIdx] -= sharesWad;
        sharesOf[to][outcomeIdx] += sharesWad;
        _trackParticipant(to);

        emit SharesMoved(from, to, outcomeIdx, sharesWad);
        return true;
    }

    function resolveByManager(uint256 _winningOutcome, string calldata _proofUri, address rewardRecipient)
        external
        onlyResolutionManager
    {
        require(stage == Stage.Active || stage == Stage.Suspended, "PMV2: not resolvable");
        require(_winningOutcome < outcomeCount, "PMV2: invalid outcome");
        require(bytes(_proofUri).length > 0, "PMV2: proof required");

        winningOutcome = _winningOutcome;
        proofUri = _proofUri;
        stage = Stage.Resolved;
        _finalizePayout(uint256(totalSharesWad[_winningOutcome]), rewardRecipient);

        emit MarketResolved(_winningOutcome, _proofUri);
    }

    function cancelByManager(string calldata reason, string calldata _proofUri, address rewardRecipient)
        external
        onlyResolutionManager
    {
        require(stage == Stage.Active || stage == Stage.Suspended, "PMV2: not cancellable");
        require(bytes(reason).length > 0, "PMV2: reason required");
        require(bytes(_proofUri).length > 0, "PMV2: proof required");

        cancelReason = reason;
        cancelProofUri = _proofUri;
        stage = Stage.Cancelled;
        _finalizePayout(_invalidPayoutLiability(), rewardRecipient);

        emit MarketCancelled(reason, _proofUri);
    }

    function emergencyCancel(string calldata reason, string calldata _proofUri) external onlyOwner {
        require(stage == Stage.Active || stage == Stage.Suspended, "PMV2: not cancellable");
        require(bytes(reason).length > 0, "PMV2: reason required");
        require(bytes(_proofUri).length > 0, "PMV2: proof required");

        cancelReason = reason;
        cancelProofUri = _proofUri;
        stage = Stage.Cancelled;
        _finalizePayout(_invalidPayoutLiability(), address(0));

        emit MarketCancelled(reason, _proofUri);
    }

    function triggerExpiry() external {
        require(stage == Stage.Active || stage == Stage.Suspended, "PMV2: not active");
        require(block.timestamp > resolutionTime + RESOLUTION_GRACE_PERIOD, "PMV2: grace not passed");
        _expire("Expired: not resolved within grace period", "");
    }

    function redeem() external nonReentrant {
        require(
            stage == Stage.Resolved || stage == Stage.Cancelled || stage == Stage.Expired,
            "PMV2: redeem closed"
        );
        require(!hasRedeemed[msg.sender], "PMV2: already redeemed");

        uint256 payout;
        if (stage == Stage.Resolved) {
            payout = sharesOf[msg.sender][winningOutcome];
            sharesOf[msg.sender][winningOutcome] = 0;
        } else {
            uint256 totalUserShares;
            for (uint256 i = 0; i < outcomeCount; ) {
                uint256 bal = sharesOf[msg.sender][i];
                if (bal > 0) {
                    totalUserShares += bal;
                    sharesOf[msg.sender][i] = 0;
                }
                unchecked { i++; }
            }
            payout = totalUserShares / outcomeCount;
        }

        require(payout > 0, "PMV2: nothing to redeem");
        hasRedeemed[msg.sender] = true;
        require(address(this).balance >= payout, "PMV2: insufficient pool");

        _sendValue(payable(msg.sender), payout, "PMV2: payout failed");
        emit Redeemed(msg.sender, payout);
    }

    function editMarket(
        string calldata _title,
        string calldata _description,
        string calldata _category
    ) external onlyOwner onlyEditable {
        require(bytes(_title).length > 0, "PMV2: empty title");
        require(bytes(_description).length > 0, "PMV2: empty description");
        require(bytes(_category).length > 0, "PMV2: empty category");
        title = _title;
        description = _description;
        category = _category;
        emit MarketEdited(_title, _description, _category);
    }

    function suspend() external onlyOwner {
        require(stage == Stage.Active, "PMV2: not active");
        stage = Stage.Suspended;
        emit MarketSuspended();
    }

    function resume() external onlyOwner {
        require(stage == Stage.Suspended, "PMV2: not suspended");
        stage = Stage.Active;
        emit MarketResumed();
    }

    function editDeadline(uint256 newDeadline) external onlyOwner onlyEditable {
        require(newDeadline > block.timestamp, "PMV2: deadline must be future");
        require(newDeadline <= resolutionTime, "PMV2: deadline after resolution");
        marketDeadline = newDeadline;
        emit DeadlineEdited(newDeadline);
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
        int256[] memory q = _getSharesArray();
        probs = new int256[](outcomeCount);
        for (uint256 i = 0; i < outcomeCount; ) {
            probs[i] = LMSRMath.impliedProbability(q, i, b);
            unchecked { i++; }
        }
    }

    function getImpliedProbability(uint256 outcomeIdx) public view returns (uint256) {
        require(outcomeIdx < outcomeCount, "PMV2: invalid outcome");
        int256 prob = LMSRMath.impliedProbability(_getSharesArray(), outcomeIdx, b);
        return uint256(prob);
    }

    function previewBuy(uint256 outcomeIdx, uint256 sharesWad) external view returns (uint256 costWei) {
        require(outcomeIdx < outcomeCount, "PMV2: invalid outcome");
        if (sharesWad == 0) return 0;
        int256 raw = LMSRMath.tradeCost(_getSharesArray(), outcomeIdx, int256(sharesWad), b);
        costWei = raw > 0 ? uint256(raw) : 0;
    }

    function previewSell(uint256 outcomeIdx, uint256 sharesWad) external view returns (uint256 proceedsWei) {
        require(outcomeIdx < outcomeCount, "PMV2: invalid outcome");
        if (sharesWad == 0) return 0;
        int256 raw = LMSRMath.tradeCost(_getSharesArray(), outcomeIdx, -int256(sharesWad), b);
        proceedsWei = raw < 0 ? uint256(-raw) : 0;
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
        for (uint256 i = 0; i < outcomeCount; ) {
            _shares[i] = sharesOf[user][i];
            unchecked { i++; }
        }
        _redeemed = hasRedeemed[user];
        _canRedeem = (stage == Stage.Resolved || stage == Stage.Cancelled || stage == Stage.Expired)
            && !hasRedeemed[user];
    }

    function resolutionDeadline() external view returns (uint256) {
        return resolutionTime + RESOLUTION_GRACE_PERIOD;
    }

    function isTradingOpen() public view returns (bool) {
        return stage == Stage.Active && block.timestamp <= marketDeadline;
    }

    function _assertTradingAllowed() internal view {
        require(isTradingOpen(), "PMV2: trading closed");
    }

    function _finalizePayout(uint256 claimWei, address rewardRecipient) internal {
        uint256 pool = address(this).balance;
        require(pool >= claimWei, "PMV2: insolvent");

        totalClaimWei = claimWei;
        uint256 surplus = pool - claimWei;
        uint256 fee = (surplus * PLATFORM_FEE_BPS) / 10_000;
        uint256 resolverReward = rewardRecipient == address(0) ? 0 : (surplus * RESOLVER_REWARD_BPS) / 10_000;
        if (resolverReward > fee) resolverReward = fee;
        uint256 protocolFee = fee - resolverReward;
        resolvedPoolWei = pool - fee;

        if (protocolFee > 0) {
            _sendValue(payable(_owner), protocolFee, "PMV2: fee failed");
            emit FeeCollected(_owner, protocolFee);
        }
        if (resolverReward > 0) {
            _sendValue(payable(rewardRecipient), resolverReward, "PMV2: reward failed");
            emit ResolverRewardPaid(rewardRecipient, resolverReward);
        }
    }

    function _invalidPayoutLiability() internal view returns (uint256 liability) {
        for (uint256 i = 0; i < outcomeCount; ) {
            liability += uint256(totalSharesWad[i]) / outcomeCount;
            unchecked { i++; }
        }
    }

    function _expire(string memory reason, string memory proof) internal {
        cancelReason = reason;
        cancelProofUri = proof;
        stage = Stage.Expired;
        _finalizePayout(_invalidPayoutLiability(), address(0));
        emit MarketCancelled(reason, proof);
    }

    function _getSharesArray() internal view returns (int256[] memory q) {
        q = new int256[](outcomeCount);
        for (uint256 i = 0; i < outcomeCount; ) {
            q[i] = totalSharesWad[i];
            unchecked { i++; }
        }
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

    receive() external payable {}
}
