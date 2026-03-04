import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, LENS_ADDRESS, STAGE } from '../../config/network';
import { FACTORY_ABI, LENS_ABI, MARKET_ABI } from '../../config/abis';
import { PageLoader } from '../../components/LoadingSpinner';
import { formatUSDC } from '../../utils/format';

interface FeeEvent {
  market: string;
  title: string;
  amount: bigint;
  resolvedPoolWei: bigint;
}

export default function FeeManagement() {
  const { readProvider } = useWallet();
  const [loading, setLoading] = useState(true);
  const [totalFeesCollected, setTotalFeesCollected] = useState(0n);
  const [totalResolved, setTotalResolved] = useState(0);
  const [totalResolvedVolume, setTotalResolvedVolume] = useState(0n);
  const [feeEvents, setFeeEvents] = useState<FeeEvent[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
        const lens = new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);
        const total = Number(await factory.totalMarkets());
        if (total === 0) { setLoading(false); return; }

        const summaries = await lens.getMarketSummaries(0, total);
        let feesSum = 0n;
        let resolvedCount = 0;
        let resolvedVol = 0n;
        const events: FeeEvent[] = [];

        for (const s of summaries) {
          if (Number(s.stage) !== STAGE.Resolved) continue;
          resolvedCount++;

          const marketContract = new ethers.Contract(s.market, MARKET_ABI, readProvider);
          const resolvedPoolWei = await marketContract.resolvedPoolWei();
          
          if (resolvedPoolWei > 0n) {
            const fee = (resolvedPoolWei * 25n) / 9975n;
            feesSum += fee;
            resolvedVol += resolvedPoolWei + fee;
            events.push({
              market: s.market,
              title: s.title,
              amount: fee,
              resolvedPoolWei,
            });
          }
        }

        setTotalFeesCollected(feesSum);
        setTotalResolved(resolvedCount);
        setTotalResolvedVolume(resolvedVol);
        setFeeEvents(events.sort((a, b) => Number(b.amount - a.amount)));
      } catch (err) {
        console.error('Failed to fetch fee data:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [readProvider]);

  if (loading) return <PageLoader />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-amber/10 border border-accent-amber/20 flex items-center justify-center">
          <svg className="w-5 h-5 text-accent-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        Fee Management
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5 text-center">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center mx-auto mb-3">
            <span className="text-lg font-bold text-primary-400">%</span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-primary-400 tabular-nums">0.25%</p>
          <p className="text-xs text-dark-400 mt-1">Fee Rate</p>
        </div>
        <div className="card p-5 text-center">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-white tabular-nums">{formatUSDC(totalFeesCollected)}</p>
          <p className="text-xs text-dark-400 mt-1">Total Fees Collected</p>
        </div>
        <div className="card p-5 text-center">
          <div className="w-10 h-10 rounded-xl bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-accent-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-white tabular-nums">{totalResolved}</p>
          <p className="text-xs text-dark-400 mt-1">Markets Resolved</p>
        </div>
      </div>

      <div className="card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <svg className="w-4 h-4 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          Fee Collection History
        </h2>
        {feeEvents.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-2xl bg-dark-800/80 border border-white/[0.08] flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-dark-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
            </div>
            <p className="text-sm text-dark-400">No resolved markets yet.</p>
            <p className="text-xs text-dark-500 mt-1">Fees are collected when markets are resolved.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-dark-400 text-left">
                  <th className="pb-3 pr-4 font-medium text-xs uppercase tracking-wider">Market</th>
                  <th className="pb-3 pr-4 font-medium text-xs uppercase tracking-wider text-right">Prize Pool</th>
                  <th className="pb-3 font-medium text-xs uppercase tracking-wider text-right">Fee (0.25%)</th>
                </tr>
              </thead>
              <tbody>
                {feeEvents.map((evt, i) => (
                  <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 pr-4">
                      <p className="text-white text-sm truncate max-w-[250px] font-medium">{evt.title}</p>
                      <p className="text-2xs text-dark-500 font-mono mt-0.5">{evt.market.slice(0, 10)}...{evt.market.slice(-6)}</p>
                    </td>
                    <td className="py-3.5 pr-4 text-right">
                      <span className="text-white font-semibold tabular-nums">{formatUSDC(evt.resolvedPoolWei)}</span>
                    </td>
                    <td className="py-3.5 text-right">
                      <span className="text-emerald-400 font-semibold tabular-nums">{formatUSDC(evt.amount)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalResolved > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
              </div>
              <span className="text-xs text-dark-400 font-medium uppercase tracking-wider">Total Resolved Volume</span>
            </div>
            <p className="text-xl font-bold text-white tabular-nums">{formatUSDC(totalResolvedVolume)} USDC</p>
          </div>
          <div className="card p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-accent-amber/10 border border-accent-amber/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-accent-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
              </div>
              <span className="text-xs text-dark-400 font-medium uppercase tracking-wider">Avg Fee per Market</span>
            </div>
            <p className="text-xl font-bold text-white tabular-nums">
              {totalResolved > 0 ? formatUSDC(totalFeesCollected / BigInt(totalResolved)) : '0'} USDC
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
