import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/owner', label: 'Create Market', icon: 'M12 4v16m8-8H4', end: true },
  { to: '/owner/active', label: 'Active Markets', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { to: '/owner/pending', label: 'Pending Resolution', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { to: '/owner/resolved', label: 'Resolved Markets', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { to: '/owner/cancelled', label: 'Cancelled / Expired', icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' },
  { to: '/owner/fees', label: 'Fee Management', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
];

export default function OwnerLayout() {
  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      {/* Sidebar */}
      <aside className="w-64 border-r border-dark-700/40 bg-dark-900/40 flex-shrink-0 hidden lg:block">
        <div className="p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-dark-400 mb-4 px-3">
            Admin Panel
          </h2>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-primary-600/20 text-primary-400'
                      : 'text-dark-300 hover:text-white hover:bg-dark-800/40'
                  }`
                }
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                </svg>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>

      {/* Mobile nav */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-dark-900/95 backdrop-blur-xl border-t border-dark-700/40">
        <div className="flex overflow-x-auto px-2 py-2 gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-[10px] font-medium transition-all ${
                  isActive
                    ? 'bg-primary-600/20 text-primary-400'
                    : 'text-dark-400 hover:text-white'
                }`
              }
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
              </svg>
              <span className="whitespace-nowrap">{item.label.split(' ')[0]}</span>
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
