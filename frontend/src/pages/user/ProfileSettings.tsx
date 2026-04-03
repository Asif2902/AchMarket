import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../../context/WalletContext';
import ImageWithFallback from '../../components/ImageWithFallback';
import EmptyState from '../../components/EmptyState';
import { PageLoader } from '../../components/LoadingSpinner';
import { EMPTY_PROFILE_PAYLOAD, normalizeProfileSlug, type ProfilePayload } from '../../utils/profileAuth';
import { fetchProfileByAddress, saveProfileBySignature } from '../../services/profile';
import type { PublicProfile as PublicProfileType } from '../../types/profile';

function toProfilePayload(profile: PublicProfileType | null): ProfilePayload {
  if (!profile) return { ...EMPTY_PROFILE_PAYLOAD };
  return {
    displayName: profile.displayName ?? '',
    avatarUrl: profile.avatarUrl ?? '',
    twitterUrl: profile.twitterUrl ?? '',
    discordUrl: profile.discordUrl ?? '',
    telegramUrl: profile.telegramUrl ?? '',
  };
}

function toProfileSlug(profile: PublicProfileType | null): string {
  return profile?.profileSlug ?? '';
}

export default function ProfileSettings() {
  const { address, signer, isConnected } = useWallet();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProfilePayload>({ ...EMPTY_PROFILE_PAYLOAD });
  const [profileSlug, setProfileSlug] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!address) {
      setLoading(false);
      setForm({ ...EMPTY_PROFILE_PAYLOAD });
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        setMsg(null);
        const response = await fetchProfileByAddress(address);
        if (!cancelled) {
          setForm(toProfilePayload(response.profile));
          setProfileSlug(toProfileSlug(response.profile));
        }
      } catch (err) {
        if (!cancelled) {
          setForm({ ...EMPTY_PROFILE_PAYLOAD });
          setProfileSlug('');
          const message = err instanceof Error ? err.message : 'Failed to load profile';
          setMsg({ type: 'error', text: message });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const publicProfileLink = useMemo(() => {
    if (!profileSlug) return '';
    if (typeof window === 'undefined') return `/profile/${profileSlug}`;
    return `${window.location.origin}/profile/${profileSlug}`;
  }, [profileSlug]);

  const previewSlug = normalizeProfileSlug(form.displayName);
  const previewProfileLink = useMemo(() => {
    if (!previewSlug) return '';
    if (typeof window === 'undefined') return `/profile/${previewSlug}`;
    return `${window.location.origin}/profile/${previewSlug}`;
  }, [previewSlug]);

  const displayName = form.displayName.trim() || (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Trader');
  const avatarUrl = form.avatarUrl.trim();
  const shareLinkHref = publicProfileLink || '#';

  const updateField = (key: keyof ProfilePayload, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCopyLink = async () => {
    if (!publicProfileLink) return;
    try {
      await navigator.clipboard.writeText(publicProfileLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      setMsg({ type: 'error', text: 'Unable to copy profile link.' });
    }
  };

  const handleSave = async () => {
    if (!address || !signer) return;

    try {
      setSaving(true);
      setMsg(null);
      const response = await saveProfileBySignature(address, form, signer);
      setForm(toProfilePayload(response.profile));
      setProfileSlug(toProfileSlug(response.profile));
      setMsg({ type: 'success', text: 'Profile updated.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save profile';
      const friendly = message === 'Request failed'
        ? 'Profile API failed. Check Vercel env vars and function logs.'
        : message;
      setMsg({ type: 'error', text: friendly });
    } finally {
      setSaving(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <EmptyState
          title="Connect Wallet"
          description="Connect your wallet to edit your public profile."
        />
      </div>
    );
  }

  if (loading) return <PageLoader />;

  const hasProfileSetup = Boolean(profileSlug);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5 animate-fade-in">
      <div className="card p-5 sm:p-6 bg-gradient-to-br from-cyan-500/[0.10] via-transparent to-primary-500/[0.08] border-cyan-400/20">
        <div className="flex flex-col md:flex-row md:items-start gap-5">
          <div className="w-28">
            <div className="w-24 h-24 rounded-2xl overflow-hidden border border-white/[0.12] bg-dark-900 mb-2">
              {avatarUrl ? (
                <ImageWithFallback src={avatarUrl} alt={displayName} className="w-full h-full" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl font-semibold text-cyan-300">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <p className="text-xs text-white font-medium truncate">{displayName}</p>
            <p className="text-2xs text-dark-500 truncate">{address}</p>
          </div>

          <div className="flex-1 space-y-3">
            <div>
              <h1 className="text-xl font-bold text-white">Profile Settings</h1>
              <p className="text-xs text-dark-400 mt-1">
                {hasProfileSetup
                  ? 'Update your public identity shown on shared profile links.'
                  : 'Set up your public profile to unlock your shareable profile page.'}
              </p>
            </div>

            {!hasProfileSetup && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
                <p className="text-xs text-amber-200 font-medium">Complete your setup to unlock your public profile page.</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Display Name</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => updateField('displayName', e.target.value)}
                  maxLength={40}
                  placeholder="Your display name"
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="label">Avatar URL</label>
                <input
                  type="url"
                  value={form.avatarUrl}
                  onChange={(e) => updateField('avatarUrl', e.target.value)}
                  placeholder="https://..."
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="label">Twitter URL</label>
                <input
                  type="url"
                  value={form.twitterUrl}
                  onChange={(e) => updateField('twitterUrl', e.target.value)}
                  placeholder="https://x.com/..."
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="label">Discord URL</label>
                <input
                  type="url"
                  value={form.discordUrl}
                  onChange={(e) => updateField('discordUrl', e.target.value)}
                  placeholder="https://discord.gg/..."
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="label">Telegram URL</label>
                <input
                  type="url"
                  value={form.telegramUrl}
                  onChange={(e) => updateField('telegramUrl', e.target.value)}
                  placeholder="https://t.me/..."
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="label">Public Profile URL</label>
                <div className="input-field text-xs text-white/70 flex items-center truncate">{publicProfileLink || 'Save to generate'}</div>
              </div>
              {previewProfileLink && previewProfileLink !== publicProfileLink && (
                <div>
                  <label className="label">Preview URL</label>
                  <div className="input-field text-xs text-white/45 flex items-center truncate">{previewProfileLink}</div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button onClick={handleCopyLink} className="btn-secondary text-xs px-3 py-2">
                {linkCopied ? 'Copied!' : 'Copy Link'}
              </button>
              <a href={shareLinkHref} className="btn-secondary text-xs px-3 py-2">
                View Public Profile
              </a>
              <button onClick={handleSave} disabled={saving || !signer} className="btn-primary text-xs px-3 py-2">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>

            {msg && (
              <div className={`p-2.5 rounded-lg text-xs border ${
                msg.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                  : 'bg-red-500/10 text-red-300 border-red-500/25'
              }`}>
                {msg.text}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link to="/profile" className="btn-secondary text-xs px-3 py-2">Back to Profile</Link>
      </div>
    </div>
  );
}
