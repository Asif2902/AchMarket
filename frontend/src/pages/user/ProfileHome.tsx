import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useWallet } from '../../context/WalletContext';
import { fetchProfileByAddress } from '../../services/profile';
import { PageLoader } from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

export default function ProfileHome() {
  const { isConnected, address } = useWallet();
  const [loading, setLoading] = useState(true);
  const [profileSlug, setProfileSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setLoading(false);
      setProfileSlug(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        const response = await fetchProfileByAddress(address);
        if (!cancelled) {
          setProfileSlug(response.profile?.profileSlug || null);
        }
      } catch {
        if (!cancelled) {
          setProfileSlug(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <EmptyState
          title="Connect Wallet"
          description="Connect your wallet to open your profile hub."
          action={<Link to="/" className="btn-secondary text-sm">Back to Markets</Link>}
        />
      </div>
    );
  }

  if (loading) return <PageLoader />;

  if (profileSlug) {
    return <Navigate to={`/profile/${profileSlug}`} replace />;
  }

  return <Navigate to="/profile/settings" replace />;
}
