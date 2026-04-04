import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchChatMessages, sendChatMessage } from '../../services/chat';
import type { ChatMessage } from '../../types/chat';
import type { Signer } from 'ethers';
import ChatMessageItem from './ChatMessage';
import ChatInput from './ChatInput';
import { fetchProfileBySlug } from '../../services/profile';

interface ChatThreadProps {
  marketAddress: string;
  userAddress: string | null;
  signer: Signer | null;
  isConnected: boolean;
  hasProfile: boolean;
}

const POLL_INTERVAL = 8000;

export default function ChatThread({
  marketAddress,
  userAddress,
  signer,
  isConnected,
  hasProfile,
}: ChatThreadProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [allProfiles, setAllProfiles] = useState<Map<string, { displayName: string; profileSlug: string }>>(new Map());
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const loadMessages = useCallback(async (append = false) => {
    try {
      const cursor = append && messages.length > 0
        ? messages[messages.length - 1].createdAt
        : undefined;
      const data = await fetchChatMessages(marketAddress, cursor);

      const newMessages = append ? [...messages, ...data.messages] : data.messages;
      setMessages(newMessages);
      setHasMore(data.hasMore);

      const slugsToFetch = new Set<string>();
      for (const msg of newMessages) {
        if (msg.authorProfile?.profileSlug) {
          slugsToFetch.add(msg.authorProfile.profileSlug);
        }
        if (msg.replyToMessage?.authorProfile?.profileSlug) {
          slugsToFetch.add(msg.replyToMessage.authorProfile.profileSlug);
        }
        for (const mention of msg.mentions) {
          slugsToFetch.add(mention);
        }
      }

      const existingSlugs = new Set(allProfiles.keys());
      const missing = [...slugsToFetch].filter(s => !existingSlugs.has(s));
      if (missing.length > 0) {
        const newProfileMap = new Map(allProfiles);
        await Promise.all(
          missing.map(async (slug) => {
            try {
              const resp = await fetchProfileBySlug(slug);
              if (resp.profile) {
                newProfileMap.set(slug, {
                  displayName: resp.profile.displayName,
                  profileSlug: resp.profile.profileSlug,
                });
              }
            } catch {
              // Profile not found for mention, skip
            }
          }),
        );
        setAllProfiles(newProfileMap);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load messages');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [marketAddress, messages, allProfiles]);

  useEffect(() => {
    loadMessages();
    const interval = setInterval(loadMessages, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadMessages]);

  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    shouldAutoScroll.current = nearBottom;
  };

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await loadMessages(true);
  };

  const handleSend = async (content: string, replyToId: string | null) => {
    if (!signer || !userAddress) return;
    try {
      const result = await sendChatMessage(userAddress, {
        marketAddress,
        content,
        replyTo: replyToId,
      }, signer);

      setMessages(prev => [result.message, ...prev]);

      if (result.message.authorProfile?.profileSlug) {
        setAllProfiles(prev => {
          const next = new Map(prev);
          next.set(result.message.authorProfile!.profileSlug, {
            displayName: result.message.authorProfile!.displayName,
            profileSlug: result.message.authorProfile!.profileSlug,
          });
          return next;
        });
      }

      setReplyTo(null);
    } catch (err: any) {
      throw err;
    }
  };

  const handleMentionClick = (slug: string) => {
    const profile = allProfiles.get(slug);
    if (profile) {
      window.location.href = `/profile/${profile.profileSlug}`;
    }
  };

  if (loading && messages.length === 0) {
    return (
      <div className="card border-white/[0.06] overflow-hidden">
        <div className="p-6 text-center">
          <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-400 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-dark-400 mt-3">Loading chat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-white/[0.06] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <h3 className="text-sm font-semibold text-white">Market Chat</h3>
        </div>
        <span className="text-2xs text-dark-500">{messages.length} messages</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-96 overflow-y-auto space-y-0"
      >
        {error && messages.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {hasMore && (
          <div className="py-2 text-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="text-xs text-primary-400 hover:text-primary-300 disabled:text-dark-600 transition-colors"
            >
              {loadingMore ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}

        {messages.length === 0 && !loading && !error && (
          <div className="p-8 text-center">
            <svg className="w-10 h-10 text-dark-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm text-dark-500">No messages yet</p>
            <p className="text-xs text-dark-600 mt-1">Be the first to share your thoughts</p>
          </div>
        )}

        {messages.map(msg => (
          <ChatMessageItem
            key={msg._id}
            message={msg}
            onReply={setReplyTo}
            allProfiles={allProfiles}
            onMentionClick={handleMentionClick}
          />
        ))}
      </div>

      <ChatInput
        marketAddress={marketAddress}
        isConnected={isConnected}
        hasProfile={hasProfile}
        onSend={handleSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        allProfiles={allProfiles}
      />
    </div>
  );
}
