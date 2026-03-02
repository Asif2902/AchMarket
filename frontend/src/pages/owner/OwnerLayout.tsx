import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/owner', label: 'Create Market', shortLabel: 'Create', icon: 'M12 4v16m8-8H4', end: true },
  { to: '/owner/active', label: 'Active Markets', shortLabel: 'Active', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { to: '/owner/pending', label: 'Pending Resolution', shortLabel: 'Pending', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { to: '/owner/resolved', label: 'Resolved Markets', shortLabel: 'Resolved', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { to: '/owner/cancelled', label: 'Cancelled / Expired', shortLabel: 'Cancelled', icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' },
  { to: '/owner/fees', label: 'Fee Management', shortLabel: 'Fees', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
];

export default function OwnerLayout() {
  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      {/* Desktop Sidebar */}
      <aside className="w-60 border-r border-white/[0.08] bg-dark-900/30 flex-shrink-0 hidden lg:block">
        <div className="p-4 sticky top-16">
          <div className="flex items-center gap-2 px-3 mb-5">
            <div className="w-6 h-6 rounded-lg bg-primary-500/15 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <span className="text-xs font-semibold text-dark-400 uppercase tracking-wider">Admin Panel</span>
          </div>
          <nav className="space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-primary-500/10 text-primary-400 shadow-glow-sm'
                      : 'text-dark-400 hover:text-white hover:bg-white/[0.04]'
                  }`
                }
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-dark-950/80 backdrop-blur-xl border-t border-white/[0.08] safe-area-bottom">
        <div className="flex overflow-x-auto scrollbar-hide px-1.5 py-1.5 gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl text-[10px] font-medium transition-all min-w-[52px] ${
                  isActive
                    ? 'bg-primary-500/15 text-primary-400'
                    : 'text-dark-500 hover:text-dark-300'
                }`
              }
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              <span className="whitespace-nowrap">{item.shortLabel}</span>
            </NavLink>
          ))}
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
        <Outlet />
      </main>
    </div>
  );
}
