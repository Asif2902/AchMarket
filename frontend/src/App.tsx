import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { WalletProvider, useWallet } from './context/WalletContext';
import Header from './components/Header';
import Footer from './components/Footer';
import MobileBottomNav from './components/MobileBottomNav';
import ToastContainer from './components/Toast';
import Home from './pages/user/Home';
import MarketDetail from './pages/user/MarketDetail';
import Portfolio from './pages/user/Portfolio';
import ProfileSettings from './pages/user/ProfileSettings';
import Analytics from './pages/user/Analytics';
import PublicProfile from './pages/user/PublicProfile';
import OwnerLayout from './pages/owner/OwnerLayout';
import CreateMarket from './pages/owner/CreateMarket';
import ActiveMarkets from './pages/owner/ActiveMarkets';
import PendingResolution from './pages/owner/PendingResolution';
import ResolvedMarkets from './pages/owner/ResolvedMarkets';
import CancelledMarkets from './pages/owner/CancelledMarkets';
import FeeManagement from './pages/owner/FeeManagement';

const sharedRoutes = (
  <>
    <Route path="/" element={<Home />} />
    <Route path="/analytics" element={<Analytics />} />
    <Route path="/market/:slug" element={<MarketDetail />} />
    <Route path="/portfolio" element={<Portfolio />} />
    <Route path="/profile/settings" element={<ProfileSettings />} />
    <Route path="/profile/:address" element={<PublicProfile />} />
  </>
);

const ownerRoutes = (
  <Route path="/owner" element={<OwnerLayout />}>
    <Route index element={<CreateMarket />} />
    <Route path="active" element={<ActiveMarkets />} />
    <Route path="pending" element={<PendingResolution />} />
    <Route path="resolved" element={<ResolvedMarkets />} />
    <Route path="cancelled" element={<CancelledMarkets />} />
    <Route path="fees" element={<FeeManagement />} />
    <Route path="analytics" element={<Analytics />} />
  </Route>
);

function AppRoutes() {
  const { isOwner, isConnected, isOwnerLoading } = useWallet();

  if (isOwnerLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isConnected && isOwner) {
    return (
      <Routes>
        {sharedRoutes}
        {ownerRoutes}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {sharedRoutes}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        <AppShell />
      </WalletProvider>
    </BrowserRouter>
  );
}

function AppShell() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [location.pathname, location.search]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pb-20 md:pb-0">
        <div key={`${location.pathname}${location.search}`} className="route-fade-in">
          <AppRoutes />
        </div>
      </main>
      <Footer />
      <MobileBottomNav />
      <ToastContainer />
    </div>
  );
}
