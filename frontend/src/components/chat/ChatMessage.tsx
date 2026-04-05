import type { ChatMessage } from '../../types/chat';

interface ChatMessageProps {
  message: ChatMessage;
  onReply: (message: ChatMessage) => void;
  onMentionClick: (slug: string) => void;
  canReply: boolean;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function renderContent(
  content: string,
  onMentionClick: (slug: string) => void,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const mentionRegex = /@([a-zA-Z0-9_-]{2,40})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(content)) !== null) {
    const matchIndex = match.index;
    const mentionSlug = match[1];
    const matchText = match[0];

    if (matchIndex > lastIndex) {
      parts.push(content.slice(lastIndex, matchIndex));
    }
    parts.push(
      <button
        key={matchIndex}
        onClick={() => {
          onMentionClick(mentionSlug);
        }}
        className="text-primary-400 hover:text-primary-300 hover:underline transition-colors font-medium"
      >
        @{mentionSlug}
      </button>,
    );
    lastIndex = matchIndex + matchText.length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [content];
}

export default function ChatMessageItem({
  message,
  onReply,
  onMentionClick,
  canReply,
}: ChatMessageProps) {
  const displayName = message.authorProfile?.displayName ?? 'Anonymous';
  const profileSlug = message.authorProfile?.profileSlug ?? '';
  const avatarUrl = message.authorProfile?.avatarUrl;

  return (
    <div className="group px-3 sm:px-4 py-3 hover:bg-white/[0.02] transition-colors">
      {message.replyToMessage && (
        <div className="flex items-center gap-1.5 mb-1.5 ml-10 text-xs text-dark-500">
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          <span className="truncate">
            {message.replyToMessage.authorProfile?.displayName ?? 'Unknown'}: {message.replyToMessage.content.slice(0, 50)}{message.replyToMessage.content.length > 50 ? '...' : ''}
          </span>
        </div>
      )}

      <div className="flex gap-2.5">
        <div className="w-8 h-8 rounded-full bg-dark-800 border border-white/[0.06] flex items-center justify-center shrink-0 overflow-hidden">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-bold text-dark-400">
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{displayName}</span>
            {profileSlug && (
              <span className="text-2xs text-dark-500">@{profileSlug}</span>
            )}
            <span className="text-2xs text-dark-600">{timeAgo(message.createdAt)}</span>
          </div>

          <div className="mt-1 text-sm text-dark-300 leading-relaxed break-words">
            {renderContent(message.content, onMentionClick)}
          </div>
        </div>

        {canReply && (
          <button
            onClick={() => onReply(message)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/[0.05] text-dark-500 hover:text-primary-400 shrink-0"
            title="Reply"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
