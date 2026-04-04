import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import type { ChatApiResponse, ChatSendResponse, ChatMessageInput } from '../types/chat';

const CHAT_API_PATH = '/api/chat';
const REQUEST_TIMEOUT_MS = 20000;

interface ChatSigningPayload {
  marketAddress: string;
  content: string;
  replyTo: string | null;
}

function serializeChatSigningPayload(payload: ChatSigningPayload): string {
  return JSON.stringify({
    marketAddress: payload.marketAddress,
    content: payload.content,
    replyTo: payload.replyTo,
  });
}

function buildChatSigningMessage(address: string, payload: ChatSigningPayload, timestamp: number): string {
  return [
    'AchMarket Chat Message',
    `Address: ${address}`,
    `Timestamp: ${timestamp}`,
    `Payload: ${serializeChatSigningPayload(payload)}`,
    'No gas fee. Sign only if you trust this request.',
  ].join('\n');
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

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
  const response = await fetchWithTimeout(withCacheBust(`${CHAT_API_PATH}?${params.toString()}`), {}, 15000);
  return parseApiResponse<ChatApiResponse>(response);
}

export async function sendChatMessage(
  address: string,
  input: ChatMessageInput,
  signer: Signer,
): Promise<ChatSendResponse> {
  const normalized = ethers.getAddress(address).toLowerCase();
  const payload: ChatSigningPayload = {
    marketAddress: input.marketAddress,
    content: input.content,
    replyTo: input.replyTo,
  };
  const timestamp = Date.now();

  const message = buildChatSigningMessage(normalized, payload, timestamp);

  const signature = await signer.signMessage(message);

  const response = await fetchWithTimeout(CHAT_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: normalized,
      payload,
      timestamp,
      signature,
    }),
  }, REQUEST_TIMEOUT_MS);

  return parseApiResponse<ChatSendResponse>(response);
}
