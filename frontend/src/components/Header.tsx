import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet } from '../context/WalletContext';

export default function Header() {
  const { isConnected, isOwner } = useWallet();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mobileMenuOpen]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  const showUserNav = isConnected && !isOwner;

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-white/[0.08] bg-dark-950/80 backdrop-blur-xl supports-[backdrop-filter]:bg-dark-950/60 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2.5 group shrink-0">
              <img
                src="/img/logos/achswap-logo.png"
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

            {/* Desktop Nav Links (User mode) */}
            {showUserNav && (
              <nav className="hidden sm:flex items-center gap-1 ml-8">
                <NavLink to="/" current={location.pathname === '/'}>Markets</NavLink>
                <NavLink to="/portfolio" current={location.pathname === '/portfolio'}>Portfolio</NavLink>
              </nav>
            )}

            {/* Desktop right side */}
            <div className="hidden sm:flex items-center gap-2.5">
              {isConnected && isOwner && (
                <span className="badge bg-primary-500/15 text-primary-400 border-primary-500/25 text-2xs">
                  Owner
                </span>
              )}
              <ConnectButton showBalance={false} />
            </div>

            {/* Mobile: right side */}
            <div className="flex sm:hidden items-center gap-2">
              <ConnectButton
                showBalance={false}
                accountStatus="avatar"
                chainStatus="icon"
              />
              {showUserNav && (
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="w-9 h-9 rounded-lg bg-dark-800/50 border border-white/[0.08] flex items-center justify-center text-dark-300 hover:bg-dark-800/70 hover:text-white transition-all duration-200"
                  aria-label="Open menu"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer — navigation links only */}
      {mobileMenuOpen && showUserNav && (
        <div className="mobile-overlay sm:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div
            ref={menuRef}
            className="mobile-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <img
                  src="/img/logos/achswap-logo.png"
                  alt="Achswap"
                  className="h-7 w-7 rounded-lg object-cover"
                />
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-bold text-white leading-none">
                    <span className="text-gradient">Ach</span>Market
                  </span>
                  <span className="text-2xs text-dark-500 leading-none mt-0.5">by Achswap</span>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="w-8 h-8 rounded-lg bg-dark-800/60 flex items-center justify-center text-dark-400 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Navigation */}
            <nav className="p-3 space-y-1">
              <MobileNavLink to="/" current={location.pathname === '/'} icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                </svg>
              }>
                Markets
              </MobileNavLink>
              <MobileNavLink to="/portfolio" current={location.pathname === '/portfolio'} icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                </svg>
              }>
                Portfolio
              </MobileNavLink>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

/* Desktop nav link */
function NavLink({ to, current, children }: { to: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 border ${
        current
          ? 'bg-primary-500/15 text-white border-primary-500/20'
          : 'text-dark-400 border-transparent hover:text-white hover:bg-white/[0.06]'
      }`}
    >
      {children}
    </Link>
  );
}

/* Mobile nav link */
function MobileNavLink({ to, current, children, icon }: { to: string; current: boolean; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 border ${
        current
          ? 'bg-primary-500/15 text-white border-primary-500/20'
          : 'text-dark-300 border-transparent hover:text-white hover:bg-white/[0.06]'
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}
