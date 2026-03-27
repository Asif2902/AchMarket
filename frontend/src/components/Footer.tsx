import { NETWORK } from '../config/network';

const ACH_SWAP_URL = 'https://achswap.app';

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-white/[0.06] hidden md:block">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <img
                src="/logo.png"
                alt="Achswap"
                className="w-9 h-9 rounded-xl object-cover shadow-glow-sm"
              />
              <div>
                <span className="text-base font-bold text-white">AchMarket</span>
                <p className="text-2xs text-dark-500">by Achswap</p>
              </div>
            </div>
            <p className="text-sm text-dark-400 leading-relaxed max-w-xs">
              Decentralized prediction markets on ARC Testnet. Trade outcomes with USDC.
            </p>
          </div>

          {/* Platform */}
          <div>
            <h4 className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-4">Platform</h4>
            <div className="space-y-2.5">
              <FooterLink href="/">Markets</FooterLink>
              <FooterLink href="/analytics">Analytics</FooterLink>
              <FooterLink href="/portfolio">Portfolio</FooterLink>
            </div>
          </div>

          {/* Ecosystem */}
          <div>
            <h4 className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-4">Ecosystem</h4>
            <div className="space-y-2.5">
              <FooterExternalLink href={ACH_SWAP_URL}>Achswap</FooterExternalLink>
              <FooterExternalLink href="https://trade.achswap.app">Swap</FooterExternalLink>
              <FooterExternalLink href="https://trade.achswap.app/bridge">Bridge</FooterExternalLink>
              <FooterExternalLink href="https://docs.achswap.app">Docs</FooterExternalLink>
            </div>
          </div>

          {/* Status */}
          <div>
            <h4 className="text-xs font-semibold text-dark-300 uppercase tracking-wider mb-4">Network</h4>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-900/40 border border-white/[0.06] w-fit">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-soft" />
              <span className="text-xs text-dark-400 font-mono">ARC Testnet</span>
              <span className="text-xs text-dark-600 font-mono">{NETWORK.chainId}</span>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-2xs text-dark-600">&copy; {new Date().getFullYear()} AchMarket. All rights reserved.</p>
          <div className="flex items-center gap-4 text-2xs text-dark-600">
            <span>Built on ARC Testnet</span>
            <span>Powered by Achswap</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="block text-sm text-dark-400 hover:text-white transition-colors">
      {children}
    </a>
  );
}

function FooterExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 text-sm text-dark-400 hover:text-white transition-colors"
    >
      {children}
      <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}
