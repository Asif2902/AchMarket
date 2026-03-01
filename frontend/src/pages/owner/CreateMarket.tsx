import { useState } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS } from '../../config/network';
import { FACTORY_ABI } from '../../config/abis';
import ImageWithFallback from '../../components/ImageWithFallback';
import ProbabilityBar from '../../components/ProbabilityBar';
import { parseContractError, makeMarketSlug } from '../../utils/format';

const CATEGORIES = ['Crypto', 'Sports', 'Politics', 'Entertainment', 'Science', 'Other'];
const DURATION_PRESETS = [
  { label: '1 Day', seconds: 86400 },
  { label: '3 Days', seconds: 259200 },
  { label: '7 Days', seconds: 604800 },
  { label: '14 Days', seconds: 1209600 },
  { label: '30 Days', seconds: 2592000 },
  { label: 'Custom', seconds: 0 },
];

export default function CreateMarket() {
  const { signer } = useWallet();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Crypto');
  const [customCategory, setCustomCategory] = useState('');
  const [imageUri, setImageUri] = useState('');
  const [outcomes, setOutcomes] = useState(['Yes', 'No']);
  const [durationPreset, setDurationPreset] = useState(604800);
  const [customDays, setCustomDays] = useState('');
  const [customHours, setCustomHours] = useState('');
  const [bValue, setBValue] = useState('100');
  const [showBTooltip, setShowBTooltip] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [txResult, setTxResult] = useState<{ type: 'success' | 'error'; text: string; market?: string; marketId?: string } | null>(null);

  const actualCategory = category === 'Other' ? customCategory : category;
  const durationSeconds = durationPreset > 0
    ? durationPreset
    : (parseInt(customDays || '0') * 86400) + (parseInt(customHours || '0') * 3600);
  const expiryDate = new Date(Date.now() + durationSeconds * 1000);

  const addOutcome = () => setOutcomes([...outcomes, '']);
  const removeOutcome = (index: number) => {
    if (outcomes.length <= 2) return;
    setOutcomes(outcomes.filter((_, i) => i !== index));
  };
  const updateOutcome = (index: number, value: string) => {
    const updated = [...outcomes];
    updated[index] = value;
    setOutcomes(updated);
  };

  const uniformProb = BigInt(Math.floor(1e18 / outcomes.length));
  const previewProbs = outcomes.map(() => uniformProb);

  const isValid =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    actualCategory.trim().length > 0 &&
    outcomes.length >= 2 &&
    outcomes.every(o => o.trim().length > 0) &&
    durationSeconds >= 3600 &&
    parseFloat(bValue) >= 10;

  const handleSubmit = async () => {
    if (!signer || !isValid) return;
    setSubmitting(true);
    setTxResult(null);
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
      const bWad = ethers.parseEther(bValue);

      const tx = await factory.createMarket(
        title.trim(),
        description.trim(),
        actualCategory.trim(),
        imageUri.trim(),
        outcomes.map(o => o.trim()),
        bWad,
        durationSeconds,
      );

      setTxResult({ type: 'success', text: 'Transaction submitted. Waiting for confirmation...' });
      const receipt = await tx.wait();

      // Find MarketCreated event
      let marketAddr = '';
      let marketId = '';
      for (const log of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed && parsed.name === 'MarketCreated') {
            marketAddr = parsed.args.market;
            marketId = parsed.args.marketId.toString();
            break;
          }
        } catch { /* skip */ }
      }

      setTxResult({
        type: 'success',
        text: 'Market created successfully!',
        market: marketAddr,
        marketId,
      });

      // Reset form
      setTitle('');
      setDescription('');
      setImageUri('');
      setOutcomes(['Yes', 'No']);
    } catch (err) {
      setTxResult({ type: 'error', text: parseContractError(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-8">Create New Market</h1>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
        {/* Form */}
        <div className="xl:col-span-3 space-y-6">
          {/* Title */}
          <div>
            <label className="label">Market Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Will BTC hit $200k by end of 2025?"
              className="input-field text-lg"
              maxLength={200}
            />
            <p className="text-xs text-dark-500 mt-1">{title.length}/200 characters</p>
          </div>

          {/* Description */}
          <div>
            <label className="label">Full Description *</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the market, resolution criteria, and any relevant context..."
              className="input-field min-h-[120px] resize-y"
              rows={5}
              maxLength={2000}
            />
            <p className="text-xs text-dark-500 mt-1">{description.length}/2000 characters</p>
          </div>

          {/* Category */}
          <div>
            <label className="label">Category *</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                    category === cat
                      ? 'border-primary-500/50 bg-primary-500/15 text-primary-400'
                      : 'border-dark-700/30 bg-dark-900/40 text-dark-300 hover:border-dark-600 hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {category === 'Other' && (
              <input
                type="text"
                value={customCategory}
                onChange={e => setCustomCategory(e.target.value)}
                placeholder="Enter custom category..."
                className="input-field mt-2"
              />
            )}
          </div>

          {/* Image URI */}
          <div>
            <label className="label">Header Image URL</label>
            <input
              type="text"
              value={imageUri}
              onChange={e => setImageUri(e.target.value)}
              placeholder="https://... or ipfs://..."
              className="input-field"
            />
            {imageUri && (
              <div className="mt-3 rounded-xl overflow-hidden border border-dark-700/30">
                <ImageWithFallback src={imageUri} alt="Preview" className="h-40 w-full" />
              </div>
            )}
          </div>

          {/* Outcomes */}
          <div>
            <label className="label">Outcome Labels *</label>
            <div className="space-y-2">
              {outcomes.map((outcome, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={outcome}
                    onChange={e => updateOutcome(i, e.target.value)}
                    placeholder={`Outcome ${i + 1}`}
                    className="input-field"
                  />
                  {outcomes.length > 2 && (
                    <button
                      onClick={() => removeOutcome(i)}
                      className="px-3 rounded-xl bg-dark-800 hover:bg-red-500/20 text-dark-400 hover:text-red-400 transition-colors border border-dark-700/30"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addOutcome} className="mt-2 text-sm text-primary-400 hover:text-primary-300 font-medium flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Outcome
            </button>
          </div>

          {/* Duration */}
          <div>
            <label className="label">Duration *</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {DURATION_PRESETS.map(d => (
                <button
                  key={d.label}
                  onClick={() => setDurationPreset(d.seconds)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                    durationPreset === d.seconds
                      ? 'border-primary-500/50 bg-primary-500/15 text-primary-400'
                      : 'border-dark-700/30 bg-dark-900/40 text-dark-300 hover:border-dark-600 hover:text-white'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {durationPreset === 0 && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-dark-400 mb-1 block">Days</label>
                  <input
                    type="number"
                    value={customDays}
                    onChange={e => setCustomDays(e.target.value)}
                    min="0"
                    placeholder="0"
                    className="input-field"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-dark-400 mb-1 block">Hours</label>
                  <input
                    type="number"
                    value={customHours}
                    onChange={e => setCustomHours(e.target.value)}
                    min="0"
                    max="23"
                    placeholder="0"
                    className="input-field"
                  />
                </div>
              </div>
            )}
            {durationSeconds >= 3600 && (
              <p className="text-xs text-dark-400 mt-2">
                Market will expire on <span className="text-white font-medium">{expiryDate.toLocaleString()}</span>
              </p>
            )}
          </div>

          {/* Liquidity parameter */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-dark-300">Liquidity Depth (b)</label>
              <div className="relative">
                <button
                  onMouseEnter={() => setShowBTooltip(true)}
                  onMouseLeave={() => setShowBTooltip(false)}
                  className="w-4 h-4 rounded-full bg-dark-600 text-dark-300 text-[10px] flex items-center justify-center hover:bg-dark-500"
                >
                  ?
                </button>
                {showBTooltip && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl bg-dark-700 border border-dark-600 text-xs text-dark-200 shadow-xl z-10">
                    <p className="font-semibold mb-1">LMSR Liquidity Parameter</p>
                    <p>Higher values = more stable prices, smaller multipliers. Lower values = more volatile prices, bigger potential returns.</p>
                    <p className="mt-1 text-dark-400">Rule of thumb: expected total volume / 10. Minimum: 10.</p>
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-2 h-2 bg-dark-700 border-r border-b border-dark-600 rotate-45"></div>
                  </div>
                )}
              </div>
            </div>
            <input
              type="number"
              value={bValue}
              onChange={e => setBValue(e.target.value)}
              min="10"
              step="10"
              className="input-field"
              placeholder="100"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="btn-primary w-full py-3 text-base font-semibold"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating Market...
              </span>
            ) : (
              'Create Market'
            )}
          </button>

          {/* Result */}
          {txResult && (
            <div className={`p-4 rounded-xl text-sm ${
              txResult.type === 'success'
                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              <p>{txResult.text}</p>
              {txResult.marketId && (
                <a
                  href={`/market/${makeMarketSlug(Number(txResult.marketId), title)}`}
                  className="mt-2 inline-block text-primary-400 hover:text-primary-300 underline"
                >
                  View Market
                </a>
              )}
            </div>
          )}
        </div>

        {/* Live Preview */}
        <div className="xl:col-span-2">
          <div className="sticky top-24">
            <h3 className="text-sm font-semibold text-dark-400 uppercase tracking-wider mb-3">Live Preview</h3>
            <div className="card overflow-hidden">
              <ImageWithFallback
                src={imageUri}
                alt={title || 'Market Preview'}
                className="h-36 w-full"
              />
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="badge bg-green-500/20 text-green-400 border-green-500/30">Active</span>
                  {actualCategory && (
                    <span className="badge bg-dark-700/50 text-dark-300 border-dark-600/30">{actualCategory}</span>
                  )}
                </div>
                <h4 className="font-semibold text-white text-sm leading-tight">
                  {title || 'Market title will appear here'}
                </h4>
                {outcomes.filter(o => o.trim()).length >= 2 && (
                  <ProbabilityBar
                    labels={outcomes.filter(o => o.trim())}
                    probabilities={previewProbs.slice(0, outcomes.filter(o => o.trim()).length)}
                    compact
                  />
                )}
                <div className="flex items-center justify-between pt-2 border-t border-dark-700/30 text-xs text-dark-400">
                  <span>0 USDC volume</span>
                  {durationSeconds >= 3600 && (
                    <span>{Math.floor(durationSeconds / 86400)}d {Math.floor((durationSeconds % 86400) / 3600)}h</span>
                  )}
                </div>
              </div>
            </div>

            {/* Form summary */}
            <div className="card p-4 mt-4 space-y-2 text-xs">
              <h4 className="font-semibold text-dark-300 mb-2">Summary</h4>
              <div className="flex justify-between">
                <span className="text-dark-400">Outcomes</span>
                <span className="text-white">{outcomes.filter(o => o.trim()).length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Duration</span>
                <span className="text-white">
                  {durationSeconds >= 86400
                    ? `${Math.floor(durationSeconds / 86400)} days`
                    : `${Math.floor(durationSeconds / 3600)} hours`
                  }
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Liquidity (b)</span>
                <span className="text-white">{bValue}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Expiry</span>
                <span className="text-white">{durationSeconds >= 3600 ? expiryDate.toLocaleDateString() : '-'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
