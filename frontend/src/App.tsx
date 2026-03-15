import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
  const { isOwner, isConnected, isOwnerLoading } = useWallet();

  // Wait for owner check to complete before rendering routes
  if (isOwnerLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Owner gets access to both admin panel AND user pages
  if (isConnected && isOwner) {
    return (
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/market/:slug" element={<MarketDetail />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/owner" element={<OwnerLayout />}>
          <Route index element={<CreateMarket />} />
          <Route path="active" element={<ActiveMarkets />} />
          <Route path="pending" element={<PendingResolution />} />
          <Route path="resolved" element={<ResolvedMarkets />} />
          <Route path="cancelled" element={<CancelledMarkets />} />
          <Route path="fees" element={<FeeManagement />} />
          <Route path="analytics" element={<Analytics />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
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
        </div>
      </WalletProvider>
    </BrowserRouter>
  );
}
