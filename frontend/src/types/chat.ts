export interface ChatMessage {
  _id: string;
  marketAddress: string;
  authorAddress: string;
  authorProfile: {
    displayName: string;
    profileSlug: string;
    avatarUrl: string;
  } | null;
  content: string;
  replyTo: string | null;
  replyToMessage: {
    _id: string;
    authorProfile: {
      displayName: string;
      profileSlug: string;
    } | null;
    content: string;
  } | null;
  mentions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageInput {
  marketAddress: string;
  content: string;
  replyTo: string | null;
}

export interface ChatApiResponse {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ChatSendResponse {
  message: ChatMessage;
}

export type ChatSendErrorCode =
  | 'chat_closed'
  | 'rate_limited'
  | 'validation'
  | 'auth'
  | 'unknown';

export interface ChatServiceError extends Error {
  status?: number;
  code?: ChatSendErrorCode;
}
