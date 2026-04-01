import { Link, useLocation } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet } from '../context/WalletContext';
import { usePendingClaims } from '../hooks/usePendingClaims';

export default function Header() {
  const { isOwner } = useWallet();
  const location = useLocation();
  const { pendingCount } = usePendingClaims();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-dark-950/85 backdrop-blur-xl supports-[backdrop-filter]:bg-dark-950/70 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2.5 group shrink-0">
            <img
              src="/logo.png"
              alt="Achswap"
              className="h-8 w-8 rounded-lg object-cover shadow-lg shadow-primary-500/25 group-hover:shadow-primary-500/40 transition-shadow duration-300"
            />
            <div className="flex flex-col leading-tight">
              <span className="text-lg font-bold text-white tracking-tight leading-none">
                <span className="text-gradient">Ach</span>Market
              </span>
              <span className="text-2xs text-dark-500 leading-none mt-0.5">by Achswap</span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <nav className="hidden md:flex items-center gap-1 p-1 rounded-xl border border-white/[0.06] bg-dark-900/40">
              <NavLink to="/" active={location.pathname === '/' || location.pathname.startsWith('/market')}>
                Markets
              </NavLink>
              <NavLink to="/portfolio" active={location.pathname === '/portfolio'} badge={pendingCount > 0 ? pendingCount : undefined}>
                Portfolio
              </NavLink>
              <NavLink to="/analytics" active={location.pathname === '/analytics'}>
                Analytics
              </NavLink>
              {isOwner && (
                <NavLink to="/owner" active={location.pathname.startsWith('/owner')}>
                  Admin
                </NavLink>
              )}
            </nav>
            <ConnectButton showBalance={false} />
          </div>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  to,
  active,
  children,
  badge,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      className={`relative px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
        active
          ? 'bg-primary-500/15 text-primary-300'
          : 'text-dark-400 hover:text-white hover:bg-white/[0.06]'
      }`}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-amber-500 rounded-full flex items-center justify-center text-[9px] font-bold text-dark-950">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  );
}
