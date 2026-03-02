export default function Footer() {
  return (
    <footer className="mt-auto border-t border-white/[0.04]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <img
              src="/img/logos/achswap-logo.png"
              alt="Achswap"
              className="w-8 h-8 rounded-xl object-cover shadow-glow-sm"
            />
            <div>
              <span className="text-sm font-bold text-white">AchMarket</span>
              <p className="text-2xs text-dark-500">
                by{' '}
                <a
                  href="https://achswap.vercel.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:text-primary-300 transition-colors"
                >
                  Achswap
                </a>
              </p>
            </div>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6 text-xs text-dark-400">
            <a
              href="https://achswap.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              Part of the Achswap ecosystem
            </a>
            <span className="text-dark-700">|</span>
            <span className="text-dark-500">
              Built on ARC Testnet
            </span>
          </div>

          {/* Network badge */}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-soft" />
            <span className="text-2xs text-dark-500 font-mono">Chain 5042002</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
