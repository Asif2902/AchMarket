import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchChatMessages, sendChatMessage } from '../../services/chat';
import type { ChatMessage } from '../../types/chat';
import type { Signer } from 'ethers';
import { ethers } from 'ethers';
import ChatMessageItem from './ChatMessage';
import ChatInput from './ChatInput';
import { fetchProfileBySlug } from '../../services/profile';
import { showToast } from '../Toast';
import { STAGE } from '../../config/network';
import { MARKET_ABI } from '../../config/abis';
import { useWallet } from '../../context/WalletContext';

interface ChatThreadProps {
  marketAddress: string;
  userAddress: string | null;
  signer: Signer | null;
  isConnected: boolean;
  hasProfile: boolean;
}

const POLL_INTERVAL = 8000;

function mergeUniqueById(list: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const item of list) {
    map.set(item._id, item);
  }
  return [...map.values()];
}

function sortByCreatedAsc(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export default function ChatThread({
  marketAddress,
  userAddress,
  signer,
  isConnected,
  hasProfile,
}: ChatThreadProps) {
  const { readProvider } = useWallet();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [allProfiles, setAllProfiles] = useState<Map<string, { displayName: string; profileSlug: string }>>(new Map());
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  const profilesRef = useRef<Map<string, { displayName: string; profileSlug: string }>>(new Map());

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    profilesRef.current = allProfiles;
  }, [allProfiles]);

  const canSend = isConnected && hasProfile && isChatOpen;
  const disabledReason = !isConnected
    ? 'Connect your wallet to join the conversation'
    : !hasProfile
      ? 'You need a profile to chat'
      : 'Chat is closed for resolved or cancelled markets';

  useEffect(() => {
    setMessages([]);
    setError(null);
    setHasMore(false);
    setReplyTo(null);
    setAllProfiles(new Map());
    setLoading(true);
    shouldStickToBottom.current = true;
    messagesRef.current = [];
    profilesRef.current = new Map();
  }, [marketAddress]);

  const loadMessages = useCallback(async (append = false) => {
    try {
      const currentMessages = messagesRef.current;
      const cursor = append && currentMessages.length > 0
        ? currentMessages[0].createdAt
        : undefined;
      const data = await fetchChatMessages(marketAddress, cursor);

      const newMessages = append
        ? sortByCreatedAsc(mergeUniqueById([...data.messages, ...currentMessages]))
        : sortByCreatedAsc(mergeUniqueById([...currentMessages, ...data.messages]));

      setMessages(newMessages);
      setHasMore(data.hasMore);
      setError(null);

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

      const existingSlugs = new Set(profilesRef.current.keys());
      const missing = [...slugsToFetch].filter((s) => !existingSlugs.has(s));
      if (missing.length > 0) {
        const newProfileMap = new Map(profilesRef.current);
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
      setError(err?.message || 'Failed to load messages');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [marketAddress]);

  useEffect(() => {
    let cancelled = false;
    const checkStage = async () => {
      try {
        const market = new ethers.Contract(marketAddress, MARKET_ABI, readProvider);
        const stageRaw: bigint = await market.stage();
        if (cancelled) return;
        const stage = Number(stageRaw);
        setIsChatOpen(stage !== STAGE.Resolved && stage !== STAGE.Cancelled);
      } catch {
        if (!cancelled) setIsChatOpen(false);
      }
    };

    checkStage();
    const interval = setInterval(checkStage, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [marketAddress, readProvider]);

  useEffect(() => {
    loadMessages();
    const interval = setInterval(loadMessages, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadMessages]);

  useEffect(() => {
    if (!scrollRef.current) return;
    if (shouldStickToBottom.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    shouldStickToBottom.current = nearBottom;
    const nearTop = el.scrollTop < 40;
    if (nearTop && hasMore && !loadingMore) {
      void loadMore();
    }
  };

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;

    setLoadingMore(true);
    await loadMessages(true);

    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) return;
      const delta = node.scrollHeight - prevHeight;
      node.scrollTop = prevTop + delta;
    });
  };

  const handleSend = async (content: string, replyToId: string | null) => {
    if (!isChatOpen) {
      throw new Error('Chat is closed for resolved or cancelled markets.');
    }
    if (!signer || !userAddress) {
      throw new Error('Connect wallet to send messages.');
    }

    const result = await sendChatMessage(
      userAddress,
      {
        marketAddress,
        content,
        replyTo: replyToId,
      },
      signer,
    );

    setMessages((prev) => sortByCreatedAsc(mergeUniqueById([...prev, result.message])));

    if (result.message.authorProfile?.profileSlug) {
      const authorProfile = result.message.authorProfile;
      setAllProfiles((prev) => {
        const next = new Map(prev);
        next.set(authorProfile.profileSlug, {
          displayName: authorProfile.displayName,
          profileSlug: authorProfile.profileSlug,
        });
        return next;
      });
    }

    setReplyTo(null);
    showToast({ type: 'success', title: 'Message sent' });
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

      <div ref={scrollRef} onScroll={handleScroll} className="h-[24rem] max-h-[24rem] overflow-y-auto space-y-0">
        {error && messages.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {(hasMore || loadingMore) && (
          <div className="py-2 text-center text-xs text-dark-500">
            {loadingMore ? 'Loading older messages...' : 'Scroll up for older messages'}
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

        {messages.map((msg) => (
          <ChatMessageItem
            key={msg._id}
            message={msg}
            onReply={setReplyTo}
            onMentionClick={handleMentionClick}
            canReply={canSend}
          />
        ))}
      </div>

      <ChatInput
        isConnected={isConnected}
        hasProfile={hasProfile}
        canSend={canSend}
        disabledReason={disabledReason}
        onSend={handleSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        allProfiles={allProfiles}
      />
    </div>
  );
}
