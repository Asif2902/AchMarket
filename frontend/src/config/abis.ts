export const FACTORY_ABI = [
  // Read functions
  "function owner() view returns (address)",
  "function totalMarkets() view returns (uint256)",
  "function markets(uint256) view returns (address)",
  "function isMarket(address) view returns (bool)",
  "function minBWad() view returns (int256)",
  "function minDuration() view returns (uint256)",
  "function maxDuration() view returns (uint256)",

  // Global stats
  "function getGlobalStats() view returns (tuple(uint256 totalMarkets, uint256 totalVolumeWei, uint256 totalParticipants, uint256 activeMarkets, uint256 resolvedMarkets, uint256 cancelledOrExpiredMarkets))",

  // Paginated market list
  "function getMarketSummaries(uint256 offset, uint256 limit) view returns (tuple(address market, uint256 marketId, string title, string category, string imageUri, string[] outcomeLabels, int256[] impliedProbabilitiesWad, uint8 stage, uint256 winningOutcome, uint256 marketDeadline, uint256 totalVolumeWei, uint256 participants)[])",

  // Single market detail (includes resolvedPoolWei + resolutionDeadline + cancel info)
  "function getMarketDetail(address market) view returns (tuple(address market, string title, string description, string category, string imageUri, string proofUri, string[] outcomeLabels, int256[] totalSharesWad, int256[] impliedProbabilitiesWad, uint8 stage, uint256 winningOutcome, uint256 createdAt, uint256 marketDeadline, int256 bWad, uint256 totalVolumeWei, uint256 participants, uint256 resolvedPoolWei, uint256 resolutionDeadline, string cancelReason, string cancelProofUri))",

  // User portfolio
  "function getUserPortfolio(address user) view returns (tuple(address market, string title, string category, string[] outcomeLabels, uint256[] sharesPerOutcome, uint256 netDepositedWei, bool canRedeem, bool canRefund, bool hasRedeemed, bool hasRefunded, uint8 stage)[])",

  // Write functions
  "function createMarket(string _title, string _description, string _category, string _imageUri, string[] _outcomeLabels, int256 _bWad, uint256 _durationSeconds) returns (address market)",
  "function setMinBWad(int256 _min)",
  "function setDurationBounds(uint256 _min, uint256 _max)",
  "function editMarket(address market, string _title, string _description)",

  // Events
  "event MarketCreated(address indexed market, uint256 indexed marketId, address indexed creator, string title, string category, uint256 outcomeCount, uint256 deadline)",
] as const;

export const MARKET_ABI = [
  // Read functions
  "function title() view returns (string)",
  "function description() view returns (string)",
  "function category() view returns (string)",
  "function imageUri() view returns (string)",
  "function proofUri() view returns (string)",
  "function cancelReason() view returns (string)",
  "function cancelProofUri() view returns (string)",
  "function admin() view returns (address)",
  "function stage() view returns (uint8)",
  "function b() view returns (int256)",
  "function outcomeCount() view returns (uint256)",
  "function winningOutcome() view returns (uint256)",
  "function marketDeadline() view returns (uint256)",
  "function createdAt() view returns (uint256)",
  "function totalVolumeWei() view returns (uint256)",
  "function totalNetDepositedWei() view returns (uint256)",
  "function participantCount() view returns (uint256)",
  "function sharesOf(address, uint256) view returns (uint256)",
  "function netDepositedWei(address) view returns (uint256)",
  "function hasRedeemed(address) view returns (bool)",
  "function hasRefunded(address) view returns (bool)",
  "function resolvedPoolWei() view returns (uint256)",
  "function resolutionDeadline() view returns (uint256)",
  "function PLATFORM_FEE_BPS() view returns (uint256)",
  "function RESOLUTION_GRACE_PERIOD() view returns (uint256)",

  // View functions
  "function getMarketInfo() view returns (string _title, string _description, string _category, string _imageUri, string _proofUri, string[] _outcomeLabels, uint8 _stage, uint256 _winningOutcome, uint256 _createdAt, uint256 _marketDeadline, uint256 _totalVolumeWei, uint256 _participantCount, string _cancelReason, string _cancelProofUri)",
  "function getShares() view returns (int256[])",
  "function getImpliedProbabilities() view returns (int256[])",
  "function previewBuy(uint256 outcomeIdx, uint256 sharesWad) view returns (uint256 costWei)",
  "function previewSell(uint256 outcomeIdx, uint256 sharesWad) view returns (uint256 proceedsWei)",
  "function getUserInfo(address user) view returns (uint256[] _shares, uint256 _netDeposited, bool _redeemed, bool _refunded, bool _canRedeem, bool _canRefund)",

  // Write functions
  "function buy(uint256 outcomeIdx, uint256 sharesWad, uint256 maxCostWei) payable",
  "function sell(uint256 outcomeIdx, uint256 sharesWad, uint256 minReceiveWei)",
  "function resolve(uint256 _winningOutcome, string _proofUri)",
  "function cancel(string reason, string _proofUri)",
  "function editMarket(string _title, string _description)",
  "function triggerExpiry()",
  "function redeem()",
  "function refund()",

  // Events
  "event SharesBought(address indexed trader, uint256 indexed outcomeIndex, uint256 sharesWad, uint256 costWei)",
  "event SharesSold(address indexed trader, uint256 indexed outcomeIndex, uint256 sharesWad, uint256 proceedsWei)",
  "event MarketResolved(uint256 winningOutcome, string proofUri)",
  "event MarketCancelled(string reason, string proofUri)",
  "event MarketEdited(string newTitle, string newDescription)",
  "event Redeemed(address indexed user, uint256 amountWei)",
  "event Refunded(address indexed user, uint256 amountWei)",
  "event FeeCollected(address indexed recipient, uint256 amountWei)",
] as const;
