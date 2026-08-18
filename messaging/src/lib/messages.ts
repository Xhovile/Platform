import { apiFetch } from "./api";
import type { Conversation, MessageThreadItem } from "../types";
import { preloadConversation } from "./messagesNavigation";

export interface ConversationResponse {
  conversation: Conversation | null;
  messages: MessageThreadItem[];
}

export interface SendMessageResponse {
  success: boolean;
  conversation: Conversation;
  message: MessageThreadItem;
}

const pendingMessageIdempotencyKeys = new Map<string, string>();

function unwrapData<T>(payload: any, fallback: T): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload.data as T) ?? fallback;
  }

  return (payload as T) ?? fallback;
}

export async function fetchInbox(): Promise<Conversation[]> {
  const result = await apiFetch("/api/messages/inbox");
  const data = unwrapData<{ items: Conversation[] }>(result, { items: [] });
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchConversation(conversationId: number): Promise<ConversationResponse> {
  const result = await apiFetch(`/api/messages/${conversationId}`);
  const data = unwrapData<ConversationResponse>(result, {
    conversation: null,
    messages: [],
  });

  return {
    conversation: data.conversation ?? null,
    messages: Array.isArray(data.messages) ? data.messages : [],
  };
}

export async function startConversationFromListing(listingId: number): Promise<Conversation> {
  const result = await apiFetch(`/api/listings/${listingId}/messages/start`, {
    method: "POST",
  });

  const data = unwrapData<{ conversation: Conversation }>(result, {
    conversation: null as unknown as Conversation,
  });

  return data.conversation;
}

export async function startConversationFromEvent(eventId: number): Promise<Conversation> {
  const result = await apiFetch(`/api/events/${eventId}/messages/start`, {
    method: "POST",
  });

  const data = unwrapData<{ conversation: Conversation }>(result, {
    conversation: null as unknown as Conversation,
  });

  preloadConversation(data.conversation);
  return data.conversation;
}

export async function startConversationWithSeller(sellerUid: string): Promise<Conversation> {
  const result = await apiFetch(`/api/sellers/${encodeURIComponent(sellerUid)}/messages/start`, {
    method: "POST",
  });

  const data = unwrapData<{ conversation: Conversation }>(result, {
    conversation: null as unknown as Conversation,
  });

  preloadConversation(data.conversation);
  return data.conversation;
}

export async function sendMessage(
  conversationId: number,
  body: string,
  idempotencyKey?: string,
): Promise<SendMessageResponse> {
  const pendingKey = `${conversationId}:${body}`;
  const key = idempotencyKey ?? pendingMessageIdempotencyKeys.get(pendingKey) ?? crypto.randomUUID();

  if (!idempotencyKey) {
    pendingMessageIdempotencyKeys.set(pendingKey, key);
  }

  try {
    const result = await apiFetch(`/api/messages/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, idempotencyKey: key }),
    });

    pendingMessageIdempotencyKeys.delete(pendingKey);

    return unwrapData<SendMessageResponse>(result, {
      success: false,
      conversation: null as unknown as Conversation,
      message: null as unknown as MessageThreadItem,
    });
  } catch (error) {
    // Keep the key so a retry after a lost response does not create a duplicate message.
    throw error;
  }
}

export async function markConversationRead(conversationId: number): Promise<void> {
  await apiFetch(`/api/messages/${conversationId}/read`, {
    method: "POST",
  });
}

export async function deleteConversation(conversationId: number): Promise<void> {
  await apiFetch(`/api/messages/${conversationId}`, {
    method: "DELETE",
  });
}
