import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { ethers } from 'ethers';
import { Link, useSearchParams } from 'react-router-dom';
import { useWallet } from '../../context/WalletContext';
import { HYBRID_FACTORY_ADDRESS, HYBRID_LENS_ADDRESS, RESOLUTION_MANAGER_ADDRESS, STAGE } from '../../config/network';
import { HYBRID_FACTORY_ABI, HYBRID_LENS_ABI, RESOLUTION_MANAGER_ABI } from '../../config/abis';
import { makeMarketSlug, parseContractError } from '../../utils/format';
import { showToast } from '../../components/Toast';
import { compressMarketImage } from '../../utils/marketImage';
import { uploadMarketMedia } from '../../services/marketMedia';

type MarketOption = {
  market: string;
  marketId: number;
  title: string;
  stage: number;
  marketDeadline: number;
  resolutionTime: number;
  outcomeLabels: string[];
};

type Proposal = {
  id: bigint;
  resolver: string;
  outcome: bigint;
  evidenceUri: string;
  proofUri: string;
  reason: string;
  bondWei: bigint;
  challengeDeadline: bigint;
  challenged: boolean;
  challenger: string;
  counterOutcome: bigint;
  counterEvidenceUri: string;
  counterReason: string;
  finalized: boolean;
};

export default function Propose() {
  const { address, signer, readProvider, isConnected, isCorrectNetwork, switchNetwork } = useWallet();
  const [searchParams] = useSearchParams();
  const requestedMarket = searchParams.get('market') || '';

  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [selectedMarket, setSelectedMarket] = useState(requestedMarket);
  const [activeProposalId, setActiveProposalId] = useState<bigint>(0n);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [requiredBond, setRequiredBond] = useState<bigint>(0n);
  const [challengeWindowSeconds, setChallengeWindowSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [txPending, setTxPending] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [outcome, setOutcome] = useState('0');
  const [evidenceUri, setEvidenceUri] = useState('');
  const [proofUri, setProofUri] = useState('');
  const [reason, setReason] = useState('');
  const [counterOutcome, setCounterOutcome] = useState('0');
  const [counterEvidenceUri, setCounterEvidenceUri] = useState('');
  const [counterReason, setCounterReason] = useState('');

  const uploadProofImage = async (
    event: ChangeEvent<HTMLInputElement>,
    target: 'evidence' | 'proof' | 'counterEvidence',
  ) => {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;
    if (!address || !signer) {
      setStatus({ type: 'error', text: 'Connect wallet from the header to upload evidence.' });
      return;
    }
    setUploadingField(target);
    setStatus(null);
    try {
      const compressed = await compressMarketImage(selected);
      const uploaded = await uploadMarketMedia(compressed.file, address, signer, 'resolution-proof');
      if (target === 'evidence') setEvidenceUri(uploaded.url);
      if (target === 'proof') setProofUri(uploaded.url);
      if (target === 'counterEvidence') setCounterEvidenceUri(uploaded.url);
      setStatus({ type: 'success', text: `Uploaded compressed proof image (${Math.round(uploaded.byteLength / 1024)} KB).` });
    } catch (err) {
      setStatus({ type: 'error', text: err instanceof Error ? err.message : 'Failed to upload proof image.' });
    } finally {
      setUploadingField(null);
    }
  };

  const market = useMemo(
    () => markets.find((m) => m.market.toLowerCase() === selectedMarket.toLowerCase()) || null,
    [markets, selectedMarket],
  );

  const loadMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const factory = new ethers.Contract(HYBRID_FACTORY_ADDRESS, HYBRID_FACTORY_ABI, readProvider);
      const lens = new ethers.Contract(HYBRID_LENS_ADDRESS, HYBRID_LENS_ABI, readProvider);
      const resolver = new ethers.Contract(RESOLUTION_MANAGER_ADDRESS, RESOLUTION_MANAGER_ABI, readProvider);
      const total = Number(await factory.totalMarkets());
      const summaries = total > 0 ? await lens.getMarketSummaries(0, total) : [];
      const parsed: MarketOption[] = summaries.map((s: Record<string, unknown>) => ({
        market: s.market as string,
        marketId: Number(s.marketId),
        title: s.title as string,
        stage: Number(s.stage),
        marketDeadline: Number(s.marketDeadline),
        resolutionTime: Number(s.resolutionTime),
        outcomeLabels: [...(s.outcomeLabels as string[])],
      }));
      setMarkets(parsed);
      const initial = requestedMarket || parsed.find((m) => m.stage === STAGE.Active)?.market || parsed[0]?.market || '';
      setSelectedMarket((prev) => prev || initial);
      const target = selectedMarket || initial;
      if (target) {
        const [pid, bond, windowSeconds] = await Promise.all([
          resolver.activeProposalForMarket(target),
          resolver.requiredBond(target),
          resolver.challengeWindow(),
        ]);
        setActiveProposalId(pid);
        setRequiredBond(bond);
        setChallengeWindowSeconds(Number(windowSeconds));
        if (pid > 0n) {
          const p = await resolver.proposals(pid);
          setProposal({
            id: p.id,
            resolver: p.resolver,
            outcome: p.outcome,
            evidenceUri: p.evidenceUri,
            proofUri: p.proofUri,
            reason: p.reason,
            bondWei: p.bondWei,
            challengeDeadline: p.challengeDeadline,
            challenged: p.challenged,
            challenger: p.challenger,
            counterOutcome: p.counterOutcome,
            counterEvidenceUri: p.counterEvidenceUri,
            counterReason: p.counterReason,
            finalized: p.finalized,
          });
        } else {
          setProposal(null);
        }
      }
    } catch (err) {
      setStatus({ type: 'error', text: parseContractError(err) });
    } finally {
      setLoading(false);
    }
  }, [readProvider, requestedMarket, selectedMarket]);

  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

  useEffect(() => {
    if (!selectedMarket) return;
    const run = async () => {
      try {
        const resolver = new ethers.Contract(RESOLUTION_MANAGER_ADDRESS, RESOLUTION_MANAGER_ABI, readProvider);
        const [pid, bond, windowSeconds] = await Promise.all([
          resolver.activeProposalForMarket(selectedMarket),
          resolver.requiredBond(selectedMarket),
          resolver.challengeWindow(),
        ]);
        setActiveProposalId(pid);
        setRequiredBond(bond);
        setChallengeWindowSeconds(Number(windowSeconds));
        if (pid > 0n) {
          const p = await resolver.proposals(pid);
          setProposal({
            id: p.id,
            resolver: p.resolver,
            outcome: p.outcome,
            evidenceUri: p.evidenceUri,
            proofUri: p.proofUri,
            reason: p.reason,
            bondWei: p.bondWei,
            challengeDeadline: p.challengeDeadline,
            challenged: p.challenged,
            challenger: p.challenger,
            counterOutcome: p.counterOutcome,
            counterEvidenceUri: p.counterEvidenceUri,
            counterReason: p.counterReason,
            finalized: p.finalized,
          });
        } else {
          setProposal(null);
        }
      } catch (err) {
        setStatus({ type: 'error', text: parseContractError(err) });
      }
    };
    void run();
  }, [selectedMarket, readProvider]);

  const propose = async () => {
    if (!signer || !selectedMarket) return;
    setTxPending(true);
    setStatus(null);
    try {
      const resolver = new ethers.Contract(RESOLUTION_MANAGER_ADDRESS, RESOLUTION_MANAGER_ABI, signer);
      const tx = await resolver.proposeResolution(
        selectedMarket,
        BigInt(outcome || '0'),
        evidenceUri.trim(),
        proofUri.trim(),
        reason.trim(),
        { value: requiredBond },
      );
      showToast({ type: 'pending', title: 'Resolution Proposed', message: 'Waiting for confirmation...', txHash: tx.hash });
      await tx.wait();
      setStatus({ type: 'success', text: 'Proposal submitted. The challenge window is now active.' });
      await loadMarkets();
    } catch (err) {
      setStatus({ type: 'error', text: parseContractError(err) });
    } finally {
      setTxPending(false);
    }
  };

  const challenge = async () => {
    if (!signer || activeProposalId === 0n) return;
    setTxPending(true);
    setStatus(null);
    try {
      const resolver = new ethers.Contract(RESOLUTION_MANAGER_ADDRESS, RESOLUTION_MANAGER_ABI, signer);
      const tx = await resolver.challengeResolution(
        activeProposalId,
        BigInt(counterOutcome || '0'),
        counterEvidenceUri.trim(),
        counterReason.trim(),
        { value: requiredBond },
      );
      showToast({ type: 'pending', title: 'Challenge Submitted', message: 'Waiting for confirmation...', txHash: tx.hash });
      await tx.wait();
      setStatus({ type: 'success', text: 'Challenge submitted. The proposal now requires arbitration.' });
      await loadMarkets();
    } catch (err) {
      setStatus({ type: 'error', text: parseContractError(err) });
    } finally {
      setTxPending(false);
    }
  };

  const finalize = async () => {
    if (!signer || activeProposalId === 0n) return;
    setTxPending(true);
    setStatus(null);
    try {
      const resolver = new ethers.Contract(RESOLUTION_MANAGER_ADDRESS, RESOLUTION_MANAGER_ABI, signer);
      const tx = await resolver.finalizeUnchallenged(activeProposalId);
      showToast({ type: 'pending', title: 'Finalizing Proposal', message: 'Waiting for confirmation...', txHash: tx.hash });
      await tx.wait();
      setStatus({ type: 'success', text: 'Proposal finalized and market resolved.' });
      await loadMarkets();
    } catch (err) {
      setStatus({ type: 'error', text: parseContractError(err) });
    } finally {
      setTxPending(false);
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const canFinalize = proposal && !proposal.challenged && !proposal.finalized && Number(proposal.challengeDeadline) < now;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 animate-fade-in">
      <div className="mb-6">
        <p className="text-2xs uppercase tracking-[0.16em] text-primary-400 font-semibold mb-2">Bonded optimistic resolution</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Propose or challenge an outcome</h1>
        <p className="text-sm text-dark-400 mt-2 max-w-2xl">
          Resolvers submit an outcome with evidence and a bond. Anyone can challenge during the window with equal bond and counter-evidence.
        </p>
      </div>

      {!isConnected ? (
        <div className="card p-6 text-dark-300">
          Connect your wallet from the header to propose or challenge outcomes.
        </div>
      ) : !isCorrectNetwork ? (
        <button onClick={switchNetwork} className="btn-primary">Switch to ARC Testnet</button>
      ) : loading ? (
        <div className="card p-6 text-dark-400">Loading resolution data...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
          <div className="space-y-5">
            <div className="card p-5">
              <label className="text-xs text-dark-400 mb-2 block">Market</label>
              <select value={selectedMarket} onChange={(e) => setSelectedMarket(e.target.value)} className="input-field">
                {markets.map((m) => (
                  <option key={m.market} value={m.market}>
                    #{m.marketId} {m.title}
                  </option>
                ))}
              </select>
              {market && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-dark-400">
                  <span className="badge bg-dark-750/80 text-dark-300 border-white/[0.08]">Resolution time: {new Date(market.resolutionTime * 1000).toLocaleString()}</span>
                  <Link to={`/market/${makeMarketSlug(market.marketId, market.title)}`} className="text-primary-400 hover:text-primary-300">View market</Link>
                </div>
              )}
            </div>

            {activeProposalId === 0n ? (
              <div className="card p-5">
                <h2 className="section-header mb-4">Submit Proposal</h2>
                <div className="space-y-3">
                  <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="input-field">
                    {(market?.outcomeLabels || []).map((label, i) => <option key={label} value={i}>{label}</option>)}
                  </select>
                  <EvidenceInput
                    label="Evidence"
                    value={evidenceUri}
                    onChange={setEvidenceUri}
                    onUpload={(e) => uploadProofImage(e, 'evidence')}
                    uploading={uploadingField === 'evidence'}
                    placeholder="Official result URL, API snapshot URL, or uploaded image URL"
                  />
                  <EvidenceInput
                    label="Screenshot proof"
                    value={proofUri}
                    onChange={setProofUri}
                    onUpload={(e) => uploadProofImage(e, 'proof')}
                    uploading={uploadingField === 'proof'}
                    placeholder="Upload screenshot or paste proof URL"
                  />
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} className="input-field resize-none" placeholder="Short reason" />
                  <button onClick={propose} disabled={txPending || !selectedMarket || !evidenceUri.trim() || !proofUri.trim() || !reason.trim()} className="btn-primary w-full py-3">
                    {txPending ? 'Submitting...' : `Propose with ${ethers.formatEther(requiredBond)} USDC bond`}
                  </button>
                </div>
              </div>
            ) : proposal && (
              <div className="card p-5">
                <h2 className="section-header mb-4">Active Proposal #{proposal.id.toString()}</h2>
                <div className="space-y-3 text-sm">
                  <Info label="Outcome" value={market?.outcomeLabels[Number(proposal.outcome)] || proposal.outcome.toString()} />
                  <Info label="Resolver" value={proposal.resolver} mono />
                  <Info label="Evidence" value={proposal.evidenceUri} />
                  <Info label="Proof" value={proposal.proofUri} />
                  <Info label="Reason" value={proposal.reason} />
                  <Info label="Challenge deadline" value={new Date(Number(proposal.challengeDeadline) * 1000).toLocaleString()} />
                  <Info label="Status" value={proposal.finalized ? 'Finalized' : proposal.challenged ? 'Challenged, awaiting arbitration' : 'Open to challenge'} />
                </div>

                {!proposal.challenged && !proposal.finalized && (
                  <div className="mt-5 pt-5 border-t border-white/[0.08] space-y-3">
                    <h3 className="text-sm font-semibold text-white">Challenge proposal</h3>
                    <select value={counterOutcome} onChange={(e) => setCounterOutcome(e.target.value)} className="input-field">
                      {(market?.outcomeLabels || []).map((label, i) => <option key={label} value={i}>{label}</option>)}
                    </select>
                    <EvidenceInput
                      label="Counter-evidence"
                      value={counterEvidenceUri}
                      onChange={setCounterEvidenceUri}
                      onUpload={(e) => uploadProofImage(e, 'counterEvidence')}
                      uploading={uploadingField === 'counterEvidence'}
                      placeholder="Upload counter-proof or paste evidence URL"
                    />
                    <textarea value={counterReason} onChange={(e) => setCounterReason(e.target.value)} rows={3} className="input-field resize-none" placeholder="Short challenge reason" />
                    <button onClick={challenge} disabled={txPending || !counterEvidenceUri.trim() || !counterReason.trim()} className="btn-secondary w-full py-3">
                      {txPending ? 'Submitting...' : `Challenge with ${ethers.formatEther(requiredBond)} USDC bond`}
                    </button>
                  </div>
                )}

                {canFinalize && (
                  <button onClick={finalize} disabled={txPending} className="btn-primary w-full py-3 mt-4">
                    {txPending ? 'Finalizing...' : 'Finalize Unchallenged Proposal'}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="card p-5 h-fit">
            <h2 className="section-header mb-4">Bond Rules</h2>
            <div className="space-y-3 text-sm text-dark-300">
              <Info label="Required bond" value={`${ethers.formatEther(requiredBond)} USDC`} />
              <Info label="Challenge window" value={challengeWindowSeconds > 0 ? formatDuration(challengeWindowSeconds) : 'Configured on resolver'} />
              <Info label="No challenge" value="Auto-finalize after deadline" />
              <Info label="Challenge" value="Escalates to multisig arbitration" />
              <Info label="Votes" value="Reputation only, not market resolution" />
            </div>
            {status && (
              <div className={`mt-5 p-3 rounded-xl text-xs ${status.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                {status.text}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EvidenceInput({
  label,
  value,
  onChange,
  onUpload,
  uploading,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  uploading: boolean;
  placeholder: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-dark-400">{label}</label>
        <label className="text-xs text-primary-400 hover:text-primary-300 cursor-pointer">
          {uploading ? 'Uploading...' : 'Upload image'}
          <input type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={uploading} />
        </label>
      </div>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input-field" placeholder={placeholder} />
      <p className="text-2xs text-dark-500 mt-1">Uploads use the same signed R2 flow and WebP compression as market/profile images.</p>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-[0.12em] text-dark-500 font-semibold mb-1">{label}</p>
      <p className={`text-dark-200 break-words ${mono ? 'font-mono text-xs' : ''}`}>{value || '-'}</p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} hours`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} minutes`;
  return `${seconds} seconds`;
}
