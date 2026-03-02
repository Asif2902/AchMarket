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

const CATEGORY_ICONS: Record<string, string> = {
  Crypto: '\u20BF',
  Sports: '\u26BD',
  Politics: '\uD83C\uDFDB',
  Entertainment: '\uD83C\uDFAC',
  Science: '\uD83D\uDD2C',
  Other: '\u2022\u2022\u2022',
};

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-8 h-8 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-dark-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

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

  // Count completed fields for progress
  const completedSteps = [
    title.trim().length > 0,
    description.trim().length > 0,
    actualCategory.trim().length > 0,
    outcomes.length >= 2 && outcomes.every(o => o.trim().length > 0),
    durationSeconds >= 3600,
    parseFloat(bValue) >= 10,
  ].filter(Boolean).length;

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
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          Create New Market
        </h1>
        <p className="text-dark-400 text-sm mt-2 ml-[52px]">Set up a new prediction market for users to trade on.</p>
      </div>

      {/* Progress bar */}
      <div className="mb-8 card p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-dark-400">Form completion</span>
          <span className="text-xs font-semibold text-primary-400">{completedSteps}/6 fields</span>
        </div>
        <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${(completedSteps / 6) * 100}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 lg:gap-8">
        {/* Form */}
        <div className="xl:col-span-3 space-y-6">
          {/* Title section */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>}
              title="Market Title"
              subtitle="Ask a clear, unambiguous question"
            />
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Will BTC hit $200k by end of 2025?"
              className="input-field text-lg font-medium"
              maxLength={200}
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-dark-500">{title.length}/200 characters</p>
              {title.trim().length > 0 && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </span>
              )}
            </div>
          </div>

          {/* Description section */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h12" /></svg>}
              title="Full Description"
              subtitle="Describe resolution criteria and relevant context"
            />
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the market, resolution criteria, and any relevant context..."
              className="input-field min-h-[120px] resize-y"
              rows={5}
              maxLength={2000}
            />
            <p className="text-xs text-dark-500 mt-2">{description.length}/2000 characters</p>
          </div>

          {/* Category & Image */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>}
              title="Category & Image"
              subtitle="Help users discover your market"
            />

            {/* Category chips */}
            <label className="label">Category *</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`chip ${category === cat ? 'chip-active' : ''}`}
                >
                  <span>{CATEGORY_ICONS[cat]}</span>
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
                className="input-field mb-4"
              />
            )}

            {/* Image URI */}
            <label className="label">Header Image URL <span className="text-dark-500 font-normal">(optional)</span></label>
            <input
              type="text"
              value={imageUri}
              onChange={e => setImageUri(e.target.value)}
              placeholder="https://... or ipfs://..."
              className="input-field"
            />
            {imageUri && (
              <div className="mt-3 rounded-xl overflow-hidden border border-white/[0.06]">
                <ImageWithFallback src={imageUri} alt="Preview" className="h-40 w-full" />
              </div>
            )}
          </div>

          {/* Outcomes */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>}
              title="Outcome Labels"
              subtitle="Define the possible outcomes (minimum 2)"
            />
            <div className="space-y-2">
              {outcomes.map((outcome, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <div className="w-6 h-6 rounded-full bg-dark-750 border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                    <span className="text-2xs font-bold text-dark-400">{i + 1}</span>
                  </div>
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
                      className="w-10 h-10 rounded-xl bg-dark-800/80 hover:bg-red-500/15 text-dark-400 hover:text-red-400 transition-all border border-white/[0.06] hover:border-red-500/20 flex items-center justify-center flex-shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addOutcome} className="mt-3 chip hover:border-primary-500/30 hover:text-primary-400">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Outcome
            </button>
          </div>

          {/* Duration */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              title="Market Duration"
              subtitle="How long should trading be open?"
            />
            <div className="flex flex-wrap gap-2 mb-3">
              {DURATION_PRESETS.map(d => (
                <button
                  key={d.label}
                  onClick={() => setDurationPreset(d.seconds)}
                  className={`chip ${durationPreset === d.seconds ? 'chip-active' : ''}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {durationPreset === 0 && (
              <div className="flex gap-3 mt-2">
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
              <div className="mt-3 p-3 rounded-xl bg-dark-900/40 border border-white/[0.04] flex items-center gap-2">
                <svg className="w-4 h-4 text-dark-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-xs text-dark-400">
                  Expires <span className="text-white font-medium">{expiryDate.toLocaleString()}</span>
                </p>
              </div>
            )}
          </div>

          {/* Liquidity parameter */}
          <div className="card p-5">
            <SectionHeader
              icon={<svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
              title="Liquidity Depth (b)"
              subtitle="Controls price sensitivity and market stability"
            />
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={bValue}
                onChange={e => setBValue(e.target.value)}
                min="10"
                step="10"
                className="input-field flex-1"
                placeholder="100"
              />
              <div className="relative">
                <button
                  onMouseEnter={() => setShowBTooltip(true)}
                  onMouseLeave={() => setShowBTooltip(false)}
                  onClick={() => setShowBTooltip(!showBTooltip)}
                  className="w-8 h-8 rounded-full bg-dark-750 border border-white/[0.08] text-dark-400 text-xs flex items-center justify-center hover:text-white hover:border-white/[0.15] transition-colors"
                >
                  ?
                </button>
                {showBTooltip && (
                  <div className="absolute bottom-full right-0 mb-2 w-72 p-4 rounded-xl bg-dark-800 border border-white/[0.08] text-xs text-dark-200 shadow-elevated z-10 animate-fade-in">
                    <p className="font-semibold text-white mb-2">LMSR Liquidity Parameter</p>
                    <p className="text-dark-300 leading-relaxed">Higher values = more stable prices, smaller multipliers. Lower values = more volatile prices, bigger potential returns.</p>
                    <div className="divider my-3" />
                    <p className="text-dark-400">Rule of thumb: expected total volume / 10. Minimum: 10.</p>
                  </div>
                )}
              </div>
            </div>
            {/* Quick preset buttons */}
            <div className="flex gap-2 mt-3">
              {[50, 100, 250, 500, 1000].map(v => (
                <button
                  key={v}
                  onClick={() => setBValue(v.toString())}
                  className={`chip text-2xs ${bValue === v.toString() ? 'chip-active' : ''}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <div className="card p-5">
            <button
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              className="btn-primary w-full py-3.5 text-base font-semibold"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating Market...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Market
                </span>
              )}
            </button>
            {!isValid && (
              <p className="text-xs text-dark-500 text-center mt-2">Complete all required fields to enable submission</p>
            )}
          </div>

          {/* Result */}
          {txResult && (
            <div className={`card p-5 animate-fade-in-up ${
              txResult.type === 'success'
                ? 'border-emerald-500/20'
                : 'border-red-500/20'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  txResult.type === 'success' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                }`}>
                  {txResult.type === 'success' ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  )}
                </div>
                <div>
                  <p className={`text-sm font-medium ${txResult.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {txResult.text}
                  </p>
                  {txResult.marketId && (
                    <a
                      href={`/market/${makeMarketSlug(Number(txResult.marketId), title)}`}
                      className="mt-2 inline-flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 font-medium"
                    >
                      View Market
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Live Preview */}
        <div className="xl:col-span-2">
          <div className="sticky top-20">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-soft" />
              <h3 className="text-xs font-semibold text-dark-400 uppercase tracking-wider">Live Preview</h3>
            </div>

            <div className="card overflow-hidden">
              <div className="relative">
                <ImageWithFallback
                  src={imageUri}
                  alt={title || 'Market Preview'}
                  className="h-36 w-full"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-dark-900/80 via-transparent to-transparent" />
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="badge bg-emerald-500/15 text-emerald-400 border-emerald-500/25">Active</span>
                  {actualCategory && (
                    <span className="badge bg-dark-750/80 text-dark-300 border-white/[0.06]">{actualCategory}</span>
                  )}
                </div>
                <h4 className="font-semibold text-white text-sm leading-tight">
                  {title || <span className="text-dark-500 italic">Market title will appear here</span>}
                </h4>
                {outcomes.filter(o => o.trim()).length >= 2 && (
                  <ProbabilityBar
                    labels={outcomes.filter(o => o.trim())}
                    probabilities={previewProbs.slice(0, outcomes.filter(o => o.trim()).length)}
                    compact
                  />
                )}
                <div className="flex items-center justify-between pt-3 border-t border-white/[0.06] text-xs text-dark-400">
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    0 USDC volume
                  </span>
                  {durationSeconds >= 3600 && (
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {Math.floor(durationSeconds / 86400)}d {Math.floor((durationSeconds % 86400) / 3600)}h
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Form summary */}
            <div className="card p-4 mt-4">
              <h4 className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">Summary</h4>
              <div className="space-y-2.5 text-xs">
                {[
                  { label: 'Outcomes', value: outcomes.filter(o => o.trim()).length.toString(), ok: outcomes.length >= 2 && outcomes.every(o => o.trim().length > 0) },
                  { label: 'Duration', value: durationSeconds >= 86400 ? `${Math.floor(durationSeconds / 86400)} days` : `${Math.floor(durationSeconds / 3600)} hours`, ok: durationSeconds >= 3600 },
                  { label: 'Liquidity (b)', value: bValue, ok: parseFloat(bValue) >= 10 },
                  { label: 'Expiry', value: durationSeconds >= 3600 ? expiryDate.toLocaleDateString() : '-', ok: durationSeconds >= 3600 },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-dark-400 flex items-center gap-1.5">
                      {row.ok ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-dark-600" />
                      )}
                      {row.label}
                    </span>
                    <span className="text-white font-medium tabular-nums">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
