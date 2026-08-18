import type { Conversation } from "../types";

export const MESSAGES_PATH = "/messages";

let pendingConversation: Conversation | null = null;

export const preloadConversation = (conversation: Conversation) => {
  pendingConversation = conversation;
};

export const getPendingConversation = (conversationId: number | null) => {
  if (!conversationId || !pendingConversation || pendingConversation.id !== conversationId) {
    return null;
  }

  return pendingConversation;
};

export const clearPendingConversation = (conversationId: number | null) => {
  if (!conversationId || !pendingConversation || pendingConversation.id !== conversationId) {
    return;
  }

  pendingConversation = null;
};

export const navigateToMessages = () => {
  const url = new URL(window.location.href);
  url.pathname = MESSAGES_PATH;
  url.searchParams.delete("conversation");
  url.searchParams.delete("listing");
  url.searchParams.delete("image");
  url.searchParams.delete("uid");
  url.searchParams.delete("id");

  pendingConversation = null;
  window.history.pushState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
};

export const navigateToConversation = (conversationId: string | number) => {
  const url = new URL(window.location.href);
  url.pathname = MESSAGES_PATH;
  url.searchParams.set("conversation", String(conversationId));
  url.searchParams.delete("listing");
  url.searchParams.delete("image");
  url.searchParams.delete("uid");
  url.searchParams.delete("id");

  if (!pendingConversation || String(pendingConversation.id) !== String(conversationId)) {
    pendingConversation = null;
  }
  window.history.pushState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// Backwards-compatible read helper. It intentionally does not mutate module state,
// so callers can safely use it during React render.
export const consumePendingConversation = (conversationId: number | null) =>
  getPendingConversation(conversationId);

export const navigateToMessagesForListing = (listingId: string | number) => {
  const url = new URL(window.location.href);
  url.pathname = MESSAGES_PATH;
  url.searchParams.set("listing", String(listingId));
  url.searchParams.delete("conversation");
  url.searchParams.delete("image");
  url.searchParams.delete("uid");
  url.searchParams.delete("id");

  pendingConversation = null;
  window.history.pushState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
};

export const getConversationIdFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("conversation");
  return value ? Number(value) : null;
};

export const getListingIdFromMessagesUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("listing");
  return value ? Number(value) : null;
};

export const clearMessageParams = () => {
  const url = new URL(window.location.href);
  url.pathname = MESSAGES_PATH;
  url.searchParams.delete("conversation");
  url.searchParams.delete("listing");
  url.searchParams.delete("image");
  url.searchParams.delete("uid");
  url.searchParams.delete("id");

  pendingConversation = null;
  window.history.replaceState({}, "", url.toString());
};
