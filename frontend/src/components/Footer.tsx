import { Link } from 'react-router-dom';
import { NETWORK } from '../config/network';

const ACH_SWAP_URL = 'https://achswap.app';

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-white/[0.06] hidden md:block">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-col items-center gap-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <img
              src="/logo.png"
              alt="Achswap"
              className="w-9 h-9 rounded-xl object-cover shadow-glow-sm"
            />
            <div>
              <span className="text-sm font-bold text-white">AchMarket</span>
              <p className="text-2xs text-dark-500 mt-0.5">
                Decentralized prediction markets
                <br />
                by{' '}
                <a
                  href={ACH_SWAP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:text-primary-300 transition-colors"
                >
                  Achswap
                </a>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs text-dark-400">
            <Link to="/" className="hover:text-white transition-colors">Markets</Link>
            <Link to="/analytics" className="hover:text-white transition-colors">Analytics</Link>
            <Link to="/portfolio" className="hover:text-white transition-colors">Portfolio</Link>
          </div>

          <div className="flex items-center gap-6 text-xs text-dark-400">
            <a href={ACH_SWAP_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Achswap</a>
            <a href="https://trade.achswap.app" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Swap</a>
            <a href="https://trade.achswap.app/bridge" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Bridge</a>
            <a href="https://docs.achswap.app" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Docs</a>
            <a href="https://x.com/AchPredict" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-white transition-colors">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              <span>X (Twitter)</span>
            </a>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-900/40 border border-white/[0.06]">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-soft" />
            <span className="text-2xs text-dark-400 font-mono">ARC Testnet</span>
            <span className="text-2xs text-dark-600 font-mono">{NETWORK.chainId}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
