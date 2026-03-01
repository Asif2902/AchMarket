import { Link, useLocation } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { truncateAddress } from '../utils/format';
import { NETWORK } from '../config/network';

export default function Header() {
  const { address, isConnected, isOwner, isCorrectNetwork, isConnecting, connect, disconnect, switchNetwork } = useWallet();
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 glass border-b border-dark-700/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center font-bold text-white text-sm shadow-lg shadow-primary-500/20">
              A
            </div>
            <span className="text-lg font-bold text-white tracking-tight">
              Ach<span className="text-primary-400">Market</span>
            </span>
          </Link>

          {/* Nav Links (User mode) */}
          {isConnected && !isOwner && (
            <nav className="hidden sm:flex items-center gap-1">
              <NavLink to="/" current={location.pathname === '/'}>Markets</NavLink>
              <NavLink to="/portfolio" current={location.pathname === '/portfolio'}>Portfolio</NavLink>
            </nav>
          )}

          {/* Right side */}
          <div className="flex items-center gap-3">
            {isConnected && !isCorrectNetwork && (
              <button onClick={switchNetwork} className="btn-danger text-xs px-3 py-1.5">
                Wrong Network - Switch to {NETWORK.name}
              </button>
            )}

            {isConnected && isCorrectNetwork && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-800/60 border border-dark-700/50">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-dark-300">{NETWORK.name}</span>
              </div>
            )}

            {isConnected && isOwner && (
              <span className="badge bg-primary-500/20 text-primary-400 border-primary-500/30 text-xs">Owner</span>
            )}

            {isConnected ? (
              <div className="flex items-center gap-2">
                <div className="px-3 py-1.5 rounded-lg bg-dark-800/80 border border-dark-700/50 text-sm font-mono text-dark-200">
                  {truncateAddress(address!)}
                </div>
                <button
                  onClick={disconnect}
                  className="p-2 rounded-lg hover:bg-dark-700/50 text-dark-400 hover:text-white transition-colors"
                  title="Disconnect"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            ) : (
              <button onClick={connect} disabled={isConnecting} className="btn-primary text-sm">
                {isConnecting ? (
                  <span className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Connecting...
                  </span>
                ) : (
                  'Connect Wallet'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function NavLink({ to, current, children }: { to: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        current
          ? 'bg-primary-600/20 text-primary-400'
          : 'text-dark-300 hover:text-white hover:bg-dark-800/40'
      }`}
    >
      {children}
    </Link>
  );
}
