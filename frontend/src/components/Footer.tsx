import { NETWORK } from '../config/network';

const ACH_SWAP_URL = 'https://achswapfi.xyz';

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex flex-col items-center gap-6 sm:gap-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <img
              src="/img/logos/achswap-logo.png"
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

          <div className="flex items-center gap-4 text-xs text-dark-400">
            <a href={ACH_SWAP_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Achswap</a>
            <a href="https://app.achswapfi.xyz" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Swap</a>
            <a href="https://app.achswapfi.xyz/bridge" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Bridge</a>
            <a href="https://docs.achswapfi.xyz" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Docs</a>
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
