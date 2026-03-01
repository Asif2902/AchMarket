import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../../context/WalletContext';
import { FACTORY_ADDRESS, STAGE } from '../../config/network';
import { FACTORY_ABI, MARKET_ABI } from '../../config/abis';
import { PageLoader } from '../../components/LoadingSpinner';
import { formatUSDC, formatDate } from '../../utils/format';

interface FeeEvent {
  market: string;
  title: string;
  amount: bigint;
  blockNumber: number;
  txHash: string;
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
        const total = Number(await factory.totalMarkets());
        if (total === 0) { setLoading(false); return; }

        const summaries = await factory.getMarketSummaries(0, total);
        let feesSum = 0n;
        let resolvedCount = 0;
        let resolvedVol = 0n;
        const events: FeeEvent[] = [];

        for (const s of summaries) {
          if (Number(s.stage) !== STAGE.Resolved) continue;
          resolvedCount++;
          resolvedVol += s.totalVolumeWei;

          const marketContract = new ethers.Contract(s.market, MARKET_ABI, readProvider);

          // Query FeeCollected events from this market
          const filter = marketContract.filters.FeeCollected();
          const logs = await marketContract.queryFilter(filter, 0);

          for (const log of logs) {
            const eventLog = log as ethers.EventLog;
            if (eventLog.args) {
              const feeAmount = eventLog.args[1] as bigint;
              feesSum += feeAmount;
              events.push({
                market: s.market,
                title: s.title,
                amount: feeAmount,
                blockNumber: eventLog.blockNumber,
                txHash: eventLog.transactionHash,
              });
            }
          }
        }

        setTotalFeesCollected(feesSum);
        setTotalResolved(resolvedCount);
        setTotalResolvedVolume(resolvedVol);
        setFeeEvents(events.sort((a, b) => b.blockNumber - a.blockNumber));
      } catch (err) {
        console.error('Failed to fetch fee data:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [readProvider]);

  if (loading) return <PageLoader />;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Fee Management</h1>

      {/* Fee structure info */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Platform Fee Structure</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/20 text-center">
            <p className="text-3xl font-bold text-primary-400">0.25%</p>
            <p className="text-xs text-dark-400 mt-1">Fee Rate (immutable)</p>
          </div>
          <div className="p-4 rounded-xl bg-dark-800/60 border border-dark-700/30 text-center">
            <p className="text-3xl font-bold text-white">{formatUSDC(totalFeesCollected)}</p>
            <p className="text-xs text-dark-400 mt-1">Total Fees Collected (USDC)</p>
          </div>
          <div className="p-4 rounded-xl bg-dark-800/60 border border-dark-700/30 text-center">
            <p className="text-3xl font-bold text-white">{totalResolved}</p>
            <p className="text-xs text-dark-400 mt-1">Markets Resolved</p>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-dark-200">How Fees Work</h2>
        <div className="space-y-3 text-sm text-dark-400">
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">1</div>
            <p>A fixed 0.25% fee (25 basis points) is hardcoded into each PredictionMarket contract. It cannot be changed.</p>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">2</div>
            <p>The fee is deducted from the total pool balance at resolution time, <span className="text-dark-300">not</span> on each trade. This means no fee is charged on cancelled or expired markets.</p>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">3</div>
            <p>The fee is automatically sent to the admin (factory owner) during the <code className="text-dark-300 bg-dark-800 px-1 rounded">resolve()</code> transaction. No separate withdrawal is needed.</p>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">4</div>
            <p>The remaining pool (after fee) is snapshotted into <code className="text-dark-300 bg-dark-800 px-1 rounded">resolvedPoolWei</code> for fair pro-rata redemptions regardless of order.</p>
          </div>
        </div>
      </div>

      {/* Fee history */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Fee Collection History</h2>
        {feeEvents.length === 0 ? (
          <p className="text-sm text-dark-400">No fees collected yet. Fees are collected when markets are resolved.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700/50 text-dark-400 text-left">
                  <th className="pb-3 pr-4 font-medium">Market</th>
                  <th className="pb-3 pr-4 font-medium text-right">Fee Amount</th>
                  <th className="pb-3 font-medium text-right">Block</th>
                </tr>
              </thead>
              <tbody>
                {feeEvents.map((evt, i) => (
                  <tr key={i} className="border-b border-dark-700/20">
                    <td className="py-3 pr-4">
                      <p className="text-white text-sm truncate max-w-[250px]">{evt.title}</p>
                      <p className="text-xs text-dark-500 font-mono">{evt.market.slice(0, 10)}...{evt.market.slice(-6)}</p>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="text-green-400 font-semibold">{formatUSDC(evt.amount)} USDC</span>
                    </td>
                    <td className="py-3 text-right text-dark-400 font-mono text-xs">
                      #{evt.blockNumber}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Volume summary */}
      {totalResolved > 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Resolved Market Volume</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-dark-800/60 border border-dark-700/30">
              <p className="text-xs text-dark-400 mb-1">Total Resolved Volume</p>
              <p className="text-xl font-bold text-white">{formatUSDC(totalResolvedVolume)} USDC</p>
            </div>
            <div className="p-4 rounded-xl bg-dark-800/60 border border-dark-700/30">
              <p className="text-xs text-dark-400 mb-1">Average Fee per Market</p>
              <p className="text-xl font-bold text-white">
                {totalResolved > 0 ? formatUSDC(totalFeesCollected / BigInt(totalResolved)) : '0'} USDC
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
