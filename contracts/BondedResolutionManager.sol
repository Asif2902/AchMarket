// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IResolvableMarket} from "./interfaces/IResolvableMarket.sol";

/// @title BondedResolutionManager
/// @notice Replaceable optimistic resolution layer with bonded challenges and multisig arbitration.
contract BondedResolutionManager is Ownable, ReentrancyGuard {
    enum Ruling {
        ResolverWins,
        ChallengerWins,
        Invalid
    }

    struct Proposal {
        uint256 id;
        address market;
        address resolver;
        uint256 outcome;
        string evidenceUri;
        string proofUri;
        string reason;
        uint256 bondWei;
        uint256 createdAt;
        uint256 challengeDeadline;
        bool challenged;
        address challenger;
        uint256 counterOutcome;
        string counterEvidenceUri;
        string counterReason;
        bool finalized;
    }

    struct Reputation {
        int256 score;
        uint256 resolverWins;
        uint256 resolverLosses;
        uint256 challengerWins;
        uint256 challengerLosses;
        uint256 votesCast;
    }

    uint256 public constant MAX_BPS = 10_000;

    uint256 public nextProposalId = 1;
    uint256 public challengeWindow;
    uint256 public minBondWei;
    uint256 public maxBondWei;
    uint256 public bondBps;
    uint256 public resolverRewardWei;
    address public treasury;
    address public reserve;
    address public marketRegistrar;
    bool public paused;

    mapping(address => bool) public allowedMarket;
    mapping(address => bool) public marketPaused;
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public activeProposalForMarket;
    mapping(address => Reputation) public reputation;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => uint256) public resolverSupportVotes;
    mapping(uint256 => uint256) public challengerSupportVotes;

    event MarketRegistrarUpdated(address indexed registrar);
    event MarketAllowed(address indexed market, bool allowed);
    event PausedUpdated(bool paused);
    event MarketPausedUpdated(address indexed market, bool paused);
    event TreasuryUpdated(address indexed treasury);
    event ReserveUpdated(address indexed reserve);
    event BondConfigUpdated(uint256 minBondWei, uint256 maxBondWei, uint256 bondBps, uint256 resolverRewardWei);
    event ChallengeWindowUpdated(uint256 challengeWindow);
    event ResolutionProposed(
        uint256 indexed proposalId,
        address indexed market,
        address indexed resolver,
        uint256 outcome,
        uint256 bondWei,
        uint256 challengeDeadline
    );
    event ResolutionChallenged(
        uint256 indexed proposalId,
        address indexed challenger,
        uint256 counterOutcome,
        uint256 bondWei
    );
    event ProposalFinalized(uint256 indexed proposalId, Ruling ruling, uint256 winningOutcome);
    event ProposalVoided(uint256 indexed proposalId, string reason);
    event ReputationVoted(uint256 indexed proposalId, address indexed voter, bool supportsResolver, string reason);

    modifier onlyOwnerOrRegistrar() {
        require(msg.sender == owner() || msg.sender == marketRegistrar, "Resolver: not registrar");
        _;
    }

    constructor(
        address _owner,
        address _treasury,
        address _reserve,
        uint256 _challengeWindow,
        uint256 _minBondWei,
        uint256 _maxBondWei,
        uint256 _bondBps,
        uint256 _resolverRewardWei
    ) Ownable(_owner) {
        require(_owner != address(0), "Resolver: zero owner");
        require(_treasury != address(0), "Resolver: zero treasury");
        require(_reserve != address(0), "Resolver: zero reserve");
        treasury = _treasury;
        reserve = _reserve;
        _setBondConfig(_minBondWei, _maxBondWei, _bondBps, _resolverRewardWei);
        _setChallengeWindow(_challengeWindow);
    }

    function setMarketRegistrar(address registrar) external onlyOwner {
        marketRegistrar = registrar;
        emit MarketRegistrarUpdated(registrar);
    }

    function setMarketAllowed(address market, bool allowed) external onlyOwnerOrRegistrar {
        require(market != address(0), "Resolver: zero market");
        allowedMarket[market] = allowed;
        emit MarketAllowed(market, allowed);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedUpdated(_paused);
    }

    function setMarketPaused(address market, bool _paused) external onlyOwner {
        marketPaused[market] = _paused;
        emit MarketPausedUpdated(market, _paused);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Resolver: zero treasury");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setReserve(address _reserve) external onlyOwner {
        require(_reserve != address(0), "Resolver: zero reserve");
        reserve = _reserve;
        emit ReserveUpdated(_reserve);
    }

    function setBondConfig(
        uint256 _minBondWei,
        uint256 _maxBondWei,
        uint256 _bondBps,
        uint256 _resolverRewardWei
    ) external onlyOwner {
        _setBondConfig(_minBondWei, _maxBondWei, _bondBps, _resolverRewardWei);
        emit BondConfigUpdated(_minBondWei, _maxBondWei, _bondBps, _resolverRewardWei);
    }

    function setChallengeWindow(uint256 _challengeWindow) external onlyOwner {
        _setChallengeWindow(_challengeWindow);
        emit ChallengeWindowUpdated(_challengeWindow);
    }

    function proposeResolution(
        address market,
        uint256 outcome,
        string calldata evidenceUri,
        string calldata proofUri,
        string calldata reason
    ) external payable nonReentrant returns (uint256 proposalId) {
        require(!paused && !marketPaused[market], "Resolver: paused");
        require(allowedMarket[market], "Resolver: market not allowed");
        require(activeProposalForMarket[market] == 0, "Resolver: active proposal");
        require(block.timestamp >= IResolvableMarket(market).resolutionTime(), "Resolver: too early");
        require(IResolvableMarket(market).stage() == 0 || IResolvableMarket(market).stage() == 1, "Resolver: bad stage");
        require(outcome < IResolvableMarket(market).outcomeCount(), "Resolver: invalid outcome");
        require(bytes(evidenceUri).length > 0, "Resolver: evidence required");
        require(bytes(proofUri).length > 0, "Resolver: proof required");
        require(bytes(reason).length > 0, "Resolver: reason required");

        uint256 bond = requiredBond(market);
        require(msg.value >= bond, "Resolver: insufficient bond");

        proposalId = nextProposalId++;
        uint256 deadline = block.timestamp + challengeWindow;
        proposals[proposalId] = Proposal({
            id: proposalId,
            market: market,
            resolver: msg.sender,
            outcome: outcome,
            evidenceUri: evidenceUri,
            proofUri: proofUri,
            reason: reason,
            bondWei: bond,
            createdAt: block.timestamp,
            challengeDeadline: deadline,
            challenged: false,
            challenger: address(0),
            counterOutcome: 0,
            counterEvidenceUri: "",
            counterReason: "",
            finalized: false
        });
        activeProposalForMarket[market] = proposalId;

        if (msg.value > bond) _sendValue(payable(msg.sender), msg.value - bond, "Resolver: refund failed");

        emit ResolutionProposed(proposalId, market, msg.sender, outcome, bond, deadline);
    }

    function challengeResolution(
        uint256 proposalId,
        uint256 counterOutcome,
        string calldata counterEvidenceUri,
        string calldata counterReason
    ) external payable nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.id != 0, "Resolver: unknown proposal");
        require(!paused && !marketPaused[proposal.market], "Resolver: paused");
        require(!proposal.finalized, "Resolver: finalized");
        require(!proposal.challenged, "Resolver: already challenged");
        require(block.timestamp <= proposal.challengeDeadline, "Resolver: window closed");
        require(msg.sender != proposal.resolver, "Resolver: resolver cannot challenge");
        require(counterOutcome < IResolvableMarket(proposal.market).outcomeCount(), "Resolver: invalid counter");
        require(bytes(counterEvidenceUri).length > 0, "Resolver: counter evidence required");
        require(bytes(counterReason).length > 0, "Resolver: counter reason required");
        require(msg.value >= proposal.bondWei, "Resolver: equal bond required");

        proposal.challenged = true;
        proposal.challenger = msg.sender;
        proposal.counterOutcome = counterOutcome;
        proposal.counterEvidenceUri = counterEvidenceUri;
        proposal.counterReason = counterReason;

        if (msg.value > proposal.bondWei) _sendValue(payable(msg.sender), msg.value - proposal.bondWei, "Resolver: refund failed");

        emit ResolutionChallenged(proposalId, msg.sender, counterOutcome, proposal.bondWei);
    }

    function finalizeUnchallenged(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.id != 0, "Resolver: unknown proposal");
        require(!proposal.finalized, "Resolver: finalized");
        require(!proposal.challenged, "Resolver: challenged");
        require(block.timestamp > proposal.challengeDeadline, "Resolver: challenge open");

        proposal.finalized = true;
        activeProposalForMarket[proposal.market] = 0;
        IResolvableMarket(proposal.market).resolveByManager(proposal.outcome, proposal.proofUri);

        reputation[proposal.resolver].score += 10;
        reputation[proposal.resolver].resolverWins++;
        _sendValue(payable(proposal.resolver), proposal.bondWei + _availableReward(proposal.bondWei), "Resolver: payout failed");

        emit ProposalFinalized(proposalId, Ruling.ResolverWins, proposal.outcome);
    }

    function resolveChallenge(uint256 proposalId, Ruling ruling) external nonReentrant onlyOwner {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.id != 0, "Resolver: unknown proposal");
        require(proposal.challenged, "Resolver: not challenged");
        require(!proposal.finalized, "Resolver: finalized");

        proposal.finalized = true;
        activeProposalForMarket[proposal.market] = 0;

        if (ruling == Ruling.ResolverWins) {
            IResolvableMarket(proposal.market).resolveByManager(proposal.outcome, proposal.proofUri);
            _applyReputation(proposal.resolver, proposal.challenger, true);
            _settleDisputedBonds(proposal.resolver, proposal.challenger, proposal.bondWei);
            emit ProposalFinalized(proposalId, ruling, proposal.outcome);
        } else if (ruling == Ruling.ChallengerWins) {
            IResolvableMarket(proposal.market).resolveByManager(proposal.counterOutcome, proposal.counterEvidenceUri);
            _applyReputation(proposal.challenger, proposal.resolver, false);
            _settleDisputedBonds(proposal.challenger, proposal.resolver, proposal.bondWei);
            emit ProposalFinalized(proposalId, ruling, proposal.counterOutcome);
        } else {
            IResolvableMarket(proposal.market).cancelByManager("Invalid market after arbitration", proposal.counterEvidenceUri);
            reputation[proposal.resolver].score -= 5;
            reputation[proposal.resolver].resolverLosses++;
            reputation[proposal.challenger].score += 5;
            reputation[proposal.challenger].challengerWins++;
            _settleDisputedBonds(proposal.challenger, proposal.resolver, proposal.bondWei);
            emit ProposalFinalized(proposalId, ruling, type(uint256).max);
        }
    }

    function voidProposal(uint256 proposalId, string calldata reason) external nonReentrant onlyOwner {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.id != 0, "Resolver: unknown proposal");
        require(!proposal.finalized, "Resolver: finalized");
        require(bytes(reason).length > 0, "Resolver: reason required");

        proposal.finalized = true;
        activeProposalForMarket[proposal.market] = 0;

        _sendValue(payable(proposal.resolver), proposal.bondWei, "Resolver: resolver refund failed");
        if (proposal.challenged) {
            _sendValue(payable(proposal.challenger), proposal.bondWei, "Resolver: challenger refund failed");
        }

        emit ProposalVoided(proposalId, reason);
    }

    function emergencyCancelMarket(address market, string calldata reason, string calldata proofUri)
        external
        nonReentrant
        onlyOwner
    {
        require(allowedMarket[market], "Resolver: market not allowed");
        require(bytes(reason).length > 0, "Resolver: reason required");
        require(bytes(proofUri).length > 0, "Resolver: proof required");

        uint256 proposalId = activeProposalForMarket[market];
        if (proposalId != 0 && !proposals[proposalId].finalized) {
            Proposal storage proposal = proposals[proposalId];
            proposal.finalized = true;
            activeProposalForMarket[market] = 0;
            _sendValue(payable(proposal.resolver), proposal.bondWei, "Resolver: resolver refund failed");
            if (proposal.challenged) {
                _sendValue(payable(proposal.challenger), proposal.bondWei, "Resolver: challenger refund failed");
            }
            emit ProposalVoided(proposalId, reason);
        }

        IResolvableMarket(market).cancelByManager(reason, proofUri);
    }

    function voteReputation(uint256 proposalId, bool supportsResolver, string calldata reason) external {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.id != 0, "Resolver: unknown proposal");
        require(!hasVoted[proposalId][msg.sender], "Resolver: already voted");
        require(_canVote(msg.sender, proposal.market), "Resolver: ineligible voter");
        require(bytes(reason).length > 0, "Resolver: reason required");

        hasVoted[proposalId][msg.sender] = true;
        reputation[msg.sender].votesCast++;
        if (supportsResolver) {
            resolverSupportVotes[proposalId]++;
        } else {
            challengerSupportVotes[proposalId]++;
        }

        emit ReputationVoted(proposalId, msg.sender, supportsResolver, reason);
    }

    function requiredBond(address market) public view returns (uint256) {
        uint256 volumeBond = (IResolvableMarket(market).totalVolumeWei() * bondBps) / MAX_BPS;
        if (volumeBond < minBondWei) return minBondWei;
        if (volumeBond > maxBondWei) return maxBondWei;
        return volumeBond;
    }

    function _canVote(address voter, address market) internal view returns (bool) {
        Reputation storage rep = reputation[voter];
        return IResolvableMarket(market).hasParticipated(voter)
            || rep.resolverWins > 0
            || rep.resolverLosses > 0
            || rep.challengerWins > 0
            || rep.challengerLosses > 0;
    }

    function _applyReputation(address winner, address loser, bool resolverWon) internal {
        reputation[winner].score += 10;
        reputation[loser].score -= 10;
        if (resolverWon) {
            reputation[winner].resolverWins++;
            reputation[loser].challengerLosses++;
        } else {
            reputation[winner].challengerWins++;
            reputation[loser].resolverLosses++;
        }
    }

    function _settleDisputedBonds(address winner, address, uint256 bondWei) internal {
        uint256 winnerBonus = (bondWei * 50) / 100;
        uint256 treasuryShare = (bondWei * 30) / 100;
        uint256 reserveShare = bondWei - winnerBonus - treasuryShare;

        _sendValue(payable(winner), bondWei + winnerBonus + _availableReward(bondWei * 2), "Resolver: winner payout failed");
        if (treasuryShare > 0) _sendValue(payable(treasury), treasuryShare, "Resolver: treasury payout failed");
        if (reserveShare > 0) _sendValue(payable(reserve), reserveShare, "Resolver: reserve payout failed");
    }

    function _availableReward(uint256 lockedWei) internal view returns (uint256 reward) {
        if (resolverRewardWei == 0) return 0;
        uint256 bal = address(this).balance;
        if (bal <= lockedWei) return 0;
        uint256 surplus = bal - lockedWei;
        return surplus >= resolverRewardWei ? resolverRewardWei : surplus;
    }

    function _setBondConfig(
        uint256 _minBondWei,
        uint256 _maxBondWei,
        uint256 _bondBps,
        uint256 _resolverRewardWei
    ) internal {
        require(_minBondWei > 0, "Resolver: min bond zero");
        require(_maxBondWei >= _minBondWei, "Resolver: bad max bond");
        require(_bondBps <= MAX_BPS, "Resolver: bad bond bps");
        minBondWei = _minBondWei;
        maxBondWei = _maxBondWei;
        bondBps = _bondBps;
        resolverRewardWei = _resolverRewardWei;
    }

    function _setChallengeWindow(uint256 _challengeWindow) internal {
        require(_challengeWindow >= 5 minutes, "Resolver: window too short");
        challengeWindow = _challengeWindow;
    }

    function _sendValue(address payable to, uint256 amount, string memory errorMessage) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, errorMessage);
    }

    receive() external payable {}
}
