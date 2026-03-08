import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet } from '../context/WalletContext';
import { Globe } from 'lucide-react';

export default function Header() {
  const { isConnected, isOwner } = useWallet();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-dark-950/80 backdrop-blur-xl supports-[backdrop-filter]:bg-dark-950/60 shadow-lg">
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
              {isConnected && isOwner && (
                <span className="hidden sm:inline-flex badge bg-primary-500/15 text-primary-400 border-primary-500/25 text-2xs">
                  Owner
                </span>
              )}
              <ConnectButton showBalance={false} />
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="w-9 h-9 rounded-lg bg-dark-800/50 border border-white/[0.08] flex items-center justify-center text-dark-300 hover:bg-dark-800/70 hover:text-white transition-all duration-200"
                aria-label="Open menu"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div
            ref={menuRef}
            className="mobile-drawer"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <img
                  src="/logo.png"
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
                aria-label="Close menu"
                className="w-8 h-8 rounded-lg bg-dark-800/60 flex items-center justify-center text-dark-400 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="p-3 space-y-1">
              <MobileNavLink to="/" current={location.pathname === '/'} icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                </svg>
              }>
                Markets
              </MobileNavLink>
              <MobileNavLink to="/analytics" current={location.pathname === '/analytics'} icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              }>
                Analytics
              </MobileNavLink>
              {isConnected && (
              <MobileNavLink to="/portfolio" current={location.pathname === '/portfolio'} icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                </svg>
              }>
                Portfolio
              </MobileNavLink>
            )}

              <div className="my-2 border-t border-white/[0.06]" />

              <p className="px-4 py-2 text-2xs font-semibold text-dark-500 uppercase tracking-wider">Ecosystem</p>

              <MobileExternalLink href="https://app.achswapfi.xyz" icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              }>
                Swap
              </MobileExternalLink>
              <MobileExternalLink href="https://app.achswapfi.xyz/bridge" icon={
                <Globe className="w-5 h-5" />
              }>
                Bridge
              </MobileExternalLink>
              <MobileExternalLink href="https://docs.achswapfi.xyz" icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              }>
                Docs
              </MobileExternalLink>
            </nav>

            <div className="mt-auto p-4 border-t border-white/[0.06]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-soft" />
                <span className="text-2xs text-dark-500 font-mono">ARC Testnet</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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

function MobileExternalLink({ href, children, icon }: { href: string; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-dark-300 border-transparent hover:text-white hover:bg-white/[0.06] transition-all duration-200"
    >
      {icon}
      <span className="flex-1">{children}</span>
      <svg className="w-3.5 h-3.5 text-dark-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}
