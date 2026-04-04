import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import type { ChatMessage, ChatApiResponse, ChatSendResponse, ChatMessageInput } from '../types/chat';

const CHAT_API_PATH = '/api/chat';

async function parseApiResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = typeof body?.error === 'string' ? body.error : 'Request failed';
    throw new Error(errorMessage);
  }
  return body as T;
}

function withCacheBust(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
}

export async function fetchChatMessages(marketAddress: string, cursor?: string): Promise<ChatApiResponse> {
  const params = new URLSearchParams({ marketAddress });
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(withCacheBust(`${CHAT_API_PATH}?${params.toString()}`));
  return parseApiResponse<ChatApiResponse>(response);
}

export async function sendChatMessage(
  address: string,
  input: ChatMessageInput,
  signer: Signer,
): Promise<ChatSendResponse> {
  const normalized = ethers.getAddress(address);
  const payload = {
    marketAddress: input.marketAddress,
    content: input.content,
    replyTo: input.replyTo,
  };
  const timestamp = Date.now();

  const message = [
    'AchMarket Chat Message',
    `Address: ${normalized}`,
    `Timestamp: ${timestamp}`,
    `Payload: ${JSON.stringify(payload)}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');

  const signature = await signer.signMessage(message);

  const response = await fetch(CHAT_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: normalized,
      payload,
      timestamp,
      signature,
    }),
  });

  return parseApiResponse<ChatSendResponse>(response);
}
