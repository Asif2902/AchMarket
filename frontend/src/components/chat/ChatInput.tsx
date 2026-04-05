import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../../types/chat';
import { showToast } from '../Toast';

interface ChatInputProps {
  isConnected: boolean;
  hasProfile: boolean;
  canSend: boolean;
  disabledReason?: string;
  onSend: (content: string, replyTo: string | null) => Promise<void>;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  allProfiles: Map<string, { displayName: string; profileSlug: string }>;
}

export default function ChatInput({
  isConnected,
  hasProfile,
  canSend,
  disabledReason,
  onSend,
  replyTo,
  onCancelReply,
  allProfiles,
}: ChatInputProps) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionCursor, setMentionCursor] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  const profileList = [...allProfiles.values()];
  const filteredMentions = mentionQuery
    ? profileList.filter(p => p.profileSlug.toLowerCase().includes(mentionQuery.toLowerCase()))
    : profileList;

  useEffect(() => {
    setMentionCursor(0);
  }, [mentionQuery]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

    const cursorPos = e.target.selectionStart ?? 0;
    const textBeforeCursor = val.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/);

    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      setShowMentions(true);
    } else {
      setMentionQuery('');
      setShowMentions(false);
    }
  };

  const insertMention = (slug: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart ?? 0;
    const textBeforeCursor = content.slice(0, cursorPos);
    const mentionStart = textBeforeCursor.lastIndexOf('@');
    const before = content.slice(0, mentionStart);
    const after = content.slice(cursorPos);

    const newText = before + `@${slug} ` + after;
    setContent(newText);

    const newCursor = mentionStart + slug.length + 2;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    }, 0);

    setShowMentions(false);
    setMentionQuery('');
  };

  const handleSubmit = async () => {
    if (!content.trim() || sending) return;
    setSending(true);
    try {
      await onSend(content.trim(), replyTo?._id ?? null);
      setContent('');
      setShowMentions(false);
      setMentionQuery('');
    } catch (err: any) {
      const msg = err?.message || 'Failed to send message';
      showToast({
        type: 'error',
        title: 'Message not sent',
        message: msg,
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionCursor(prev => Math.min(prev + 1, filteredMentions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionCursor(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentions[mentionCursor].profileSlug);
        return;
      }
      if (e.key === 'Escape') {
        setShowMentions(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    const el = document.querySelector(`[data-mention-index="${mentionCursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [mentionCursor]);

  if (!isConnected) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-dark-400">Connect your wallet to join the conversation</p>
      </div>
    );
  }

  if (!hasProfile) {
    return (
      <div className="p-4 text-center space-y-2">
        <p className="text-sm text-dark-400">You need a profile to chat</p>
        <a
          href="/profile/settings"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500/10 hover:bg-primary-500/20 border border-primary-500/20 text-xs font-semibold text-primary-400 hover:text-primary-300 transition-all"
        >
          Create Profile
        </a>
      </div>
    );
  }

  if (!canSend) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-dark-400">{disabledReason || 'Chat is closed for this market'}</p>
      </div>
    );
  }

  return (
    <div className="border-t border-white/[0.06] p-3 sm:p-4" ref={inputRef}>
      {replyTo && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04]">
          <svg className="w-3.5 h-3.5 text-dark-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          <span className="text-xs text-dark-400 truncate flex-1">
            Replying to <span className="text-primary-400 font-medium">{replyTo.authorProfile?.displayName ?? 'Unknown'}</span>
          </span>
          <button
            onClick={onCancelReply}
            className="text-dark-500 hover:text-dark-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={showMentions ? 'Type to filter mentions...' : 'Say something... (@ to mention)'}
          disabled={sending}
          rows={2}
          className="w-full resize-none rounded-xl bg-dark-900/50 border border-white/[0.08] px-3 py-2.5 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-primary-500/40 focus:ring-1 focus:ring-primary-500/20 transition-all disabled:opacity-50"
          maxLength={500}
        />

        {showMentions && filteredMentions.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-1 max-h-40 overflow-y-auto rounded-xl bg-dark-900 border border-white/[0.1] shadow-xl z-10">
            {filteredMentions.map((profile, i) => (
              <button
                key={profile.profileSlug}
                data-mention-index={i}
                onClick={() => insertMention(profile.profileSlug)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  i === mentionCursor
                    ? 'bg-primary-500/15 text-primary-300'
                    : 'text-dark-300 hover:bg-white/[0.05]'
                }`}
              >
                <span className="font-medium">@{profile.profileSlug}</span>
                <span className="text-dark-500 text-xs ml-2">{profile.displayName}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-2xs text-dark-500">{content.length}/500</span>
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || sending}
            className="px-4 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-400 disabled:bg-dark-800 disabled:text-dark-600 text-white text-xs font-semibold transition-all flex items-center gap-1.5"
          >
            {sending ? (
              <>
                <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Send
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
