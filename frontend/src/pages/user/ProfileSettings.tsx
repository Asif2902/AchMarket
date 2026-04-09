import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../../context/WalletContext';
import ImageWithFallback from '../../components/ImageWithFallback';
import EmptyState from '../../components/EmptyState';
import { PageLoader } from '../../components/LoadingSpinner';
import { EMPTY_PROFILE_PAYLOAD, normalizeProfileSlug, type ProfilePayload } from '../../utils/profileAuth';
import { fetchProfileByAddress, saveProfileBySignature, uploadProfileAvatar, deleteProfileAvatar } from '../../services/profile';
import type { PublicProfile as PublicProfileType } from '../../types/profile';
import { compressAvatarImage } from '../../utils/avatarImage';
import { withImageVersion } from '../../utils/format';

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
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUploadSessionId, setAvatarUploadSessionId] = useState<string | null>(null);
  const [avatarUploadMeta, setAvatarUploadMeta] = useState<{ bytes: number; type: string } | null>(null);
  const [localAvatarPreviewUrl, setLocalAvatarPreviewUrl] = useState<string | null>(null);
  const [form, setForm] = useState<ProfilePayload>({ ...EMPTY_PROFILE_PAYLOAD });
  const [profileSlug, setProfileSlug] = useState('');
  const [profileUpdatedAt, setProfileUpdatedAt] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const currentRequestIdRef = useRef(0);
  const avatarUploadSessionIdRef = useRef<string | null>(null);
  const addressRef = useRef(address);
  const signerRef = useRef(signer);
  const latestPreviewUrlRef = useRef<string | null>(null);
  const latestFormRef = useRef<ProfilePayload>({ ...EMPTY_PROFILE_PAYLOAD });
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  avatarUploadSessionIdRef.current = avatarUploadSessionId;
  addressRef.current = address;
  signerRef.current = signer;

  const clearAvatarUploadSessionIfMatches = (sessionId: string) => {
    if (avatarUploadSessionIdRef.current !== sessionId) return;
    setAvatarUploading(false);
    setAvatarUploadSessionId(null);
  };

  useEffect(() => {
    if (!address) {
      setLoading(false);
      setForm({ ...EMPTY_PROFILE_PAYLOAD });
      setProfileSlug('');
      setProfileUpdatedAt('');
      setAvatarUploadMeta(null);
      setLocalAvatarPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setSaving(false);
      setAvatarUploadSessionId((current) => {
        if (current) {
          setAvatarUploading(false);
          return null;
        }
        return current;
      });
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        setMsg(null);
        setForm({ ...EMPTY_PROFILE_PAYLOAD });
        setProfileSlug('');
        setProfileUpdatedAt('');
        setAvatarUploadMeta(null);
        setLocalAvatarPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        setAvatarUploadSessionId((current) => {
          if (current) {
            setAvatarUploading(false);
            return null;
          }
          return current;
        });
        const response = await fetchProfileByAddress(address);
        if (!cancelled) {
          setForm(toProfilePayload(response.profile));
          setProfileSlug(toProfileSlug(response.profile));
          setProfileUpdatedAt(response.profile?.updatedAt ?? '');
        }
      } catch (err) {
        if (!cancelled) {
          setForm({ ...EMPTY_PROFILE_PAYLOAD });
          setProfileSlug('');
          setProfileUpdatedAt('');
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

  useEffect(() => {
    latestPreviewUrlRef.current = localAvatarPreviewUrl;
  }, [localAvatarPreviewUrl]);

  useEffect(() => {
    latestFormRef.current = form;
  }, [form]);

  useEffect(() => {
    return () => {
      if (latestPreviewUrlRef.current) {
        URL.revokeObjectURL(latestPreviewUrlRef.current);
      }
    };
  }, []);

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
  const avatarPreviewSrc = localAvatarPreviewUrl || withImageVersion(avatarUrl, profileUpdatedAt);
  const shareLinkHref = publicProfileLink || '#';

  const updateField = (key: keyof ProfilePayload, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const isWalletSessionCurrent = (expectedAddress: string, expectedSigner: typeof signer): boolean => {
    return addressRef.current === expectedAddress && signerRef.current === expectedSigner;
  };

  const handleAvatarFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const localAddress = address;
    const localSigner = signer;
    if (!localAddress || !localSigner) {
      setMsg({ type: 'error', text: 'Connect wallet to upload avatar.' });
      event.target.value = '';
      return;
    }

    let previewToRevokeOnFailure: string | null = null;
    let uploadedResult: { key: string } | null = null;
    const sessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      setAvatarUploadSessionId(sessionId);
      setAvatarUploading(true);
      setMsg(null);

      const compressed = await compressAvatarImage(selected);
      previewToRevokeOnFailure = compressed.previewUrl;

      if (!isWalletSessionCurrent(localAddress, localSigner)) {
        if (previewToRevokeOnFailure) {
          URL.revokeObjectURL(previewToRevokeOnFailure);
          previewToRevokeOnFailure = null;
        }
        return;
      }

      const confirmed = window.confirm('Upload this image as your avatar?');
      if (!confirmed) {
        URL.revokeObjectURL(compressed.previewUrl);
        previewToRevokeOnFailure = null;
        return;
      }

      if (!isWalletSessionCurrent(localAddress, localSigner)) {
        if (previewToRevokeOnFailure) {
          URL.revokeObjectURL(previewToRevokeOnFailure);
          previewToRevokeOnFailure = null;
        }
        return;
      }

      const uploaded = await uploadProfileAvatar(compressed.file, localAddress, localSigner);
      uploadedResult = { key: uploaded.key };

      if (!isWalletSessionCurrent(localAddress, localSigner)) {
        try {
          await deleteProfileAvatar(localAddress, uploaded.key, localSigner);
        } catch (cleanupErr) {
          console.error('Failed to cleanup orphaned avatar upload:', cleanupErr);
        }
        if (previewToRevokeOnFailure) {
          URL.revokeObjectURL(previewToRevokeOnFailure);
          previewToRevokeOnFailure = null;
        }
        return;
      }

      const nextPayload: ProfilePayload = { ...latestFormRef.current, avatarUrl: uploaded.url };
      const saved = await saveProfileBySignature(localAddress, nextPayload, localSigner);

      if (!isWalletSessionCurrent(localAddress, localSigner)) {
        if (previewToRevokeOnFailure) {
          URL.revokeObjectURL(previewToRevokeOnFailure);
          previewToRevokeOnFailure = null;
        }
        return;
      }

      const savedPayload = toProfilePayload(saved.profile);
      const mergedPayload: ProfilePayload = {
        ...latestFormRef.current,
        avatarUrl: savedPayload.avatarUrl,
      };

      setForm(mergedPayload);
      setProfileSlug(toProfileSlug(saved.profile));
      setProfileUpdatedAt(saved.profile?.updatedAt ?? '');
      setAvatarUploadMeta({ bytes: uploaded.byteLength, type: uploaded.contentType });
      setLocalAvatarPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return compressed.previewUrl;
      });
      previewToRevokeOnFailure = null;

      setMsg({ type: 'success', text: 'Avatar uploaded and saved.' });
    } catch (err) {
      if (uploadedResult) {
        try {
          await deleteProfileAvatar(localAddress, uploadedResult.key, localSigner);
        } catch (cleanupErr) {
          console.error('Failed to cleanup orphaned avatar upload:', cleanupErr);
        }
      }
      if (previewToRevokeOnFailure) {
        URL.revokeObjectURL(previewToRevokeOnFailure);
      }
      if (isWalletSessionCurrent(localAddress, localSigner)) {
        const message = err instanceof Error ? err.message : 'Failed to upload avatar.';
        setMsg({ type: 'error', text: message });
      }
    } finally {
      clearAvatarUploadSessionIfMatches(sessionId);
      event.target.value = '';
    }
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
    if (!address || !signer || avatarUploading) return;
    const requestIdCaptured = ++currentRequestIdRef.current;

    try {
      setSaving(true);
      setMsg(null);
      const response = await saveProfileBySignature(address, form, signer);
      if (requestIdCaptured === currentRequestIdRef.current && addressRef.current === address && signerRef.current === signer) {
        setForm(toProfilePayload(response.profile));
        setProfileSlug(toProfileSlug(response.profile));
        setProfileUpdatedAt(response.profile?.updatedAt ?? '');
        setMsg({ type: 'success', text: 'Profile updated.' });
      }
    } catch (err) {
      if (requestIdCaptured === currentRequestIdRef.current && addressRef.current === address && signerRef.current === signer) {
        const message = err instanceof Error ? err.message : 'Failed to save profile';
        const friendly = message === 'Request failed'
          ? 'Profile API failed. Check Vercel env vars and function logs.'
          : message;
        setMsg({ type: 'error', text: friendly });
      }
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
              {avatarPreviewSrc ? (
                <ImageWithFallback src={avatarPreviewSrc} alt={displayName} className="w-full h-full" />
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
                <label htmlFor="profile-displayName" className="label">Display Name</label>
                <input
                  id="profile-displayName"
                  type="text"
                  value={form.displayName}
                  onChange={(e) => updateField('displayName', e.target.value)}
                  disabled={avatarUploading || saving}
                  maxLength={40}
                  placeholder="Your display name"
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label htmlFor="profile-avatarUrl" className="label">Avatar (R2 Upload)</label>
                <input
                  id="profile-avatarUrl"
                  type="text"
                  value={form.avatarUrl}
                  readOnly
                  placeholder="Upload image to generate URL"
                  className="input-field text-sm text-white/70"
                />
                <input
                  ref={avatarFileInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleAvatarFileChange}
                  disabled={avatarUploading || saving}
                />
                <button
                  type="button"
                  onClick={() => avatarFileInputRef.current?.click()}
                  disabled={avatarUploading || saving}
                  aria-label="Upload avatar image"
                  className={`mt-2 w-full text-left rounded-xl border border-dashed border-white/[0.2] bg-dark-900/50 p-3 transition-colors ${
                    avatarUploading || saving
                      ? 'opacity-60 cursor-not-allowed'
                      : 'hover:border-cyan-400/40 hover:bg-dark-850/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center">
                      <svg className="w-4 h-4 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">
                        {avatarUploading ? 'Uploading avatar...' : 'Click to upload avatar'}
                      </p>
                      <p className="text-2xs text-dark-500">Auto-compressed · max 2MB · WebP optimized</p>
                    </div>
                  </div>
                </button>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {avatarUploadMeta && (
                    <span className="text-2xs text-dark-500">{Math.max(1, Math.round(avatarUploadMeta.bytes / 1024))}KB · {avatarUploadMeta.type}</span>
                  )}
                </div>
              </div>
              <div>
                <label htmlFor="profile-twitterUrl" className="label">Twitter URL</label>
                <input
                  id="profile-twitterUrl"
                  type="url"
                  value={form.twitterUrl}
                  onChange={(e) => updateField('twitterUrl', e.target.value)}
                  disabled={avatarUploading || saving}
                  placeholder="https://x.com/..."
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label htmlFor="profile-discordUrl" className="label">Discord URL</label>
                <input
                  id="profile-discordUrl"
                  type="url"
                  value={form.discordUrl}
                  onChange={(e) => updateField('discordUrl', e.target.value)}
                  disabled={avatarUploading || saving}
                  placeholder="https://discord.gg/..."
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label htmlFor="profile-telegramUrl" className="label">Telegram URL</label>
                <input
                  id="profile-telegramUrl"
                  type="url"
                  value={form.telegramUrl}
                  onChange={(e) => updateField('telegramUrl', e.target.value)}
                  disabled={avatarUploading || saving}
                  placeholder="https://t.me/..."
                  className="input-field text-sm"
                />
              </div>
              <div>
                <span className="label">Public Profile URL</span>
                <div className="input-field text-xs text-white/70 flex items-center truncate" role="textbox" aria-readonly="true" aria-label="Public profile URL">{publicProfileLink || 'Save to generate'}</div>
              </div>
              {previewProfileLink && previewProfileLink !== publicProfileLink && (
                <div>
                  <span className="label">Preview URL</span>
                  <div className="input-field text-xs text-white/45 flex items-center truncate" role="textbox" aria-readonly="true" aria-label="Preview profile URL">{previewProfileLink}</div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button onClick={handleCopyLink} disabled={!publicProfileLink} className={`btn-secondary text-xs px-3 py-2 ${!publicProfileLink ? 'opacity-40 cursor-not-allowed' : ''}`}>
                {linkCopied ? 'Copied!' : 'Copy Link'}
              </button>
              {publicProfileLink ? (
                <a href={publicProfileLink} className="btn-secondary text-xs px-3 py-2">
                  View Public Profile
                </a>
              ) : (
                <button disabled className="btn-secondary text-xs px-3 py-2 opacity-40 cursor-not-allowed">
                  View Public Profile
                </button>
              )}
              <button onClick={handleSave} disabled={saving || avatarUploading || !signer} className="btn-primary text-xs px-3 py-2">
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
