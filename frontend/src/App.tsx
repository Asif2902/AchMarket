import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Analytics as VercelAnalytics } from '@vercel/analytics/react';
import { WalletProvider, useWallet } from './context/WalletContext';
import Header from './components/Header';
import Footer from './components/Footer';
import ToastContainer from './components/Toast';
import Home from './pages/user/Home';
import MarketDetail from './pages/user/MarketDetail';
import Portfolio from './pages/user/Portfolio';
import Analytics from './pages/user/Analytics';
import OwnerLayout from './pages/owner/OwnerLayout';
import CreateMarket from './pages/owner/CreateMarket';
import ActiveMarkets from './pages/owner/ActiveMarkets';
import PendingResolution from './pages/owner/PendingResolution';
import ResolvedMarkets from './pages/owner/ResolvedMarkets';
import CancelledMarkets from './pages/owner/CancelledMarkets';
import FeeManagement from './pages/owner/FeeManagement';

function AppRoutes() {
  const { isOwner, isConnected } = useWallet();

  // If connected as owner, show owner interface
  if (isConnected && isOwner) {
    return (
      <Routes>
        <Route path="/owner" element={<OwnerLayout />}>
          <Route index element={<CreateMarket />} />
          <Route path="active" element={<ActiveMarkets />} />
          <Route path="pending" element={<PendingResolution />} />
          <Route path="resolved" element={<ResolvedMarkets />} />
          <Route path="cancelled" element={<CancelledMarkets />} />
          <Route path="fees" element={<FeeManagement />} />
          <Route path="analytics" element={<Analytics />} />
        </Route>
        {/* Owner can also view market details */}
        <Route path="/market/:slug" element={<MarketDetail />} />
        {/* Redirect root to owner panel */}
        <Route path="/" element={<Navigate to="/owner" replace />} />
        <Route path="*" element={<Navigate to="/owner" replace />} />
      </Routes>
    );
  }

  // User interface
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/analytics" element={<Analytics />} />
      <Route path="/market/:slug" element={<MarketDetail />} />
      <Route path="/portfolio" element={<Portfolio />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1">
            <AppRoutes />
          </main>
          <Footer />
          <ToastContainer />
          <VercelAnalytics />
        </div>
      </WalletProvider>
    </BrowserRouter>
  );
}
