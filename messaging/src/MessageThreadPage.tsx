import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Paperclip, SendHorizontal, ShieldAlert } from "lucide-react";
import type { Conversation, MessageThreadItem, MessageReportReason } from "./types";
import { useAuthUser } from "./hooks/useAuthUser";
import { EVENTS_PATH, navigateToLogin, navigateToListingDetails, navigateToPath, navigateToSellerProfile } from "./lib/appNavigation";
import { navigateToMessages, getConversationIdFromUrl, consumePendingConversation } from "./lib/messagesNavigation";
import { deleteConversation, fetchConversation, markConversationRead, sendMessage } from "./lib/messages";
import {
  blockConversationUser,
  markConversationSpam,
  reportConversation,
  unblockConversationUser,
} from "./lib/messageModeration";
import ConversationActionsMenu from "./components/messages/ConversationActionsMenu";
import ActionConfirmDialog from "./components/messages/ActionConfirmDialog";
import MessageReportDialog from "./components/messages/MessageReportDialog";

function timeLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function hasBlockedState(conversation: Conversation | null) {
  return Boolean(conversation?.blocked_by_you || conversation?.blocked_by_other);
}

export default function MessageThreadPage() {
  const { user, loading: authLoading } = useAuthUser();
  const [conversationId] = useState<number | null>(() => getConversationIdFromUrl());
  const preloadedConversation = consumePendingConversation(conversationId);
  const [loading, setLoading] = useState(!preloadedConversation);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(preloadedConversation);
  const [messages, setMessages] = useState<MessageThreadItem[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const reloadConversation = async (id: number) => {
    const result = await fetchConversation(id);
    setConversation(result.conversation);
    setMessages(result.messages);
    await markConversationRead(id);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigateToLogin();
      return;
    }

    if (!conversationId || Number.isNaN(conversationId)) {
      navigateToMessages();
      return;
    }

    let cancelled = false;

    const load = async () => {
      setStatus(null);
      try {
        const result = await fetchConversation(conversationId);
        if (cancelled) return;

        setConversation(result.conversation);
        setMessages(result.messages);
        await markConversationRead(conversationId);
      } catch (error: any) {
        if (!cancelled) setStatus(error?.message || "Failed to load conversation.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (preloadedConversation) {
      setLoading(false);
      void load();
    } else {
      setLoading(true);
      void load();
    }

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, conversationId]);

  useEffect(() => {
    if (loading || authLoading || !conversation) return;
    const raf = window.requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [messages, loading, authLoading, conversation]);

  const handleSend = async () => {
    if (!conversationId || !draft.trim()) return;

    setBusy(true);
    try {
      const result = await sendMessage(conversationId, draft.trim());
      setConversation(result.conversation);
      setMessages((prev) => [...prev, result.message]);
      setDraft("");
      window.requestAnimationFrame(() => {
        threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    } catch (error: any) {
      setStatus(error?.message || "Failed to send message.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteChat = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      await deleteConversation(conversationId);
      setDeleteOpen(false);
      navigateToMessages();
    } catch (error: any) {
      setStatus(error?.message || "Failed to delete chat.");
    } finally {
      setBusy(false);
    }
  };

  const confirmBlock = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      await blockConversationUser(conversationId, { scope: "messages" });
      await reloadConversation(conversationId);
      setBlockOpen(false);
    } catch (error: any) {
      setStatus(error?.message || "Failed to block user.");
    } finally {
      setBusy(false);
    }
  };

  const confirmReport = async (payload: { reason: MessageReportReason; details: string }) => {
    if (!conversationId) return;
    setBusy(true);
    try {
      await reportConversation(conversationId, payload);
      setStatus("Conversation reported.");
      setReportOpen(false);
    } catch (error: any) {
      setStatus(error?.message || "Failed to report conversation.");
    } finally {
      setBusy(false);
    }
  };

  const handleSpam = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      await markConversationSpam(conversationId);
      setStatus("Marked as spam and sent to moderation.");
    } catch (error: any) {
      setStatus(error?.message || "Failed to mark as spam.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnblock = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      await unblockConversationUser(conversationId);
      await reloadConversation(conversationId);
    } catch (error: any) {
      setStatus(error?.message || "Failed to unblock user.");
    } finally {
      setBusy(false);
    }
  };

  const isPlainLeftClick = (event: React.MouseEvent<HTMLAnchorElement>) =>
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey;

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100">
        <Loader2 className="h-10 w-10 animate-spin text-zinc-700" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="min-h-screen bg-zinc-100 px-4 py-6 text-zinc-900 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigateToMessages()}
          className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to inbox
        </button>

        {status ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {status}
          </div>
        ) : null}
      </div>
    );
  }

  const blocked = hasBlockedState(conversation);
  const canReply = conversation.can_reply !== false && !blocked;
  const threadType = String(conversation.thread_type || "listing");
  const isEventThread = threadType === "event" && !!conversation.event;
  const isSellerThread = threadType === "seller";
  const listingName = conversation.listing?.name || "Listing";
  const sellerName = conversation.seller?.business_name || "Seller";
  const eventTitle = conversation.event?.title || "Event";
  const listingPrice = Number(conversation.listing?.price || 0);
  const sellerProfileHref = `/seller?uid=${encodeURIComponent(conversation.seller.uid)}`;

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-zinc-100 text-zinc-900">
      <header className="shrink-0 border-b border-zinc-200 bg-zinc-100/95 backdrop-blur z-20">
        <div className="flex items-center gap-3 px-4 py-4">
          <button
            type="button"
            onClick={() => navigateToMessages()}
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-white"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          {isSellerThread ? (
            <a
              href={sellerProfileHref}
              onClick={(event) => {
                if (!isPlainLeftClick(event)) return;
                event.preventDefault();
                navigateToSellerProfile(conversation.seller.uid);
              }}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-base font-extrabold text-zinc-900 sm:text-lg">{sellerName}</p>
              <p className="text-sm font-semibold text-zinc-500">Seller profile</p>
            </a>
          ) : isEventThread ? (
            <a
              href={`${EVENTS_PATH}?event=${conversation.event?.id}`}
              onClick={(event) => {
                if (!isPlainLeftClick(event)) return;
                event.preventDefault();
                if (conversation.event) {
                  navigateToPath(`${EVENTS_PATH}?event=${conversation.event.id}`);
                }
              }}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-base font-extrabold text-zinc-900 sm:text-lg">{eventTitle}</p>
              <p className="text-sm font-semibold text-zinc-500">
                {listingPrice > 0 ? `MWK ${listingPrice.toLocaleString()}` : "Free event"}
              </p>
            </a>
          ) : (
            <a
              href={`/listing?listing=${conversation.listing.id}`}
              onClick={(event) => {
                if (!isPlainLeftClick(event)) return;
                event.preventDefault();
                navigateToListingDetails(conversation.listing.id, 0);
              }}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-base font-extrabold text-zinc-900 sm:text-lg">{listingName}</p>
              <p className="text-sm font-semibold text-zinc-500">
                {listingPrice > 0 ? `MWK ${listingPrice.toLocaleString()}` : "Price unavailable"}
              </p>
            </a>
          )}

          {isEventThread ? (
            <div className="ml-auto max-w-[10rem] shrink-0 text-right sm:max-w-[14rem]">
              <p className="truncate text-sm font-bold text-zinc-900 sm:text-base">
                {conversation.event?.organizer_name || sellerName}
              </p>
              <p className="text-[11px] font-semibold text-zinc-500">Event owner</p>
            </div>
          ) : (
            <a
              href={sellerProfileHref}
              onClick={(event) => {
                if (!isPlainLeftClick(event)) return;
                event.preventDefault();
                navigateToSellerProfile(conversation.seller.uid);
              }}
              className="ml-auto max-w-[10rem] shrink-0 text-right sm:max-w-[14rem]"
            >
              <p className="truncate text-sm font-bold text-zinc-900 sm:text-base">{sellerName}</p>
              <p className="text-[11px] font-semibold text-zinc-500">Seller profile</p>
            </a>
          )}

          <ConversationActionsMenu
            className="shrink-0 ml-1"
            onDelete={() => setDeleteOpen(true)}
            onBlock={() => setBlockOpen(true)}
            onUnblock={handleUnblock}
            onReport={() => setReportOpen(true)}
            onSpam={handleSpam}
            blockedByYou={Boolean(conversation.blocked_by_you)}
            blockedByOther={Boolean(conversation.blocked_by_other)}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {(conversation.blocked_by_you || conversation.blocked_by_other) ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="h-4 w-4" />
              Messaging is restricted.
            </div>
            <p className="mt-1 text-xs">
              {conversation.blocked_by_you
                ? "You blocked this user. Unblock them from the actions menu if needed."
                : "This user blocked messaging. You cannot send new messages here."}
            </p>
          </div>
        ) : null}

        {status ? (
          <div className="mx-4 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {status}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length ? (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.sender_uid === user?.uid ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-3xl px-4 py-3 text-sm ${
                    msg.sender_uid === user?.uid
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-200 text-zinc-900"
                  }`}
                >
                  <p>{msg.body}</p>
                  <p
                    className={`mt-2 text-[11px] ${
                      msg.sender_uid === user?.uid
                        ? "text-zinc-300"
                        : "text-zinc-500"
                    }`}
                  >
                    {timeLabel(msg.created_at)}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              No messages yet.
            </div>
          )}
          <div ref={threadEndRef} />
        </div>

        <div className="shrink-0 border-t border-zinc-200 bg-white px-4 py-4">
          <div className="flex items-end gap-3">
            <button
              type="button"
              aria-label="Attachments coming soon"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 text-zinc-400"
              disabled
            >
              <Paperclip className="h-5 w-5" />
            </button>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={canReply ? "Type your message..." : "Messaging is blocked."}
              disabled={!canReply}
              className="min-h-12 flex-1 resize-none rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none disabled:bg-zinc-100 disabled:text-zinc-500"
            />

            <button
              type="button"
              disabled={busy || !draft.trim() || !canReply}
              onClick={() => void handleSend()}
              className="inline-flex items-center justify-center rounded-2xl bg-zinc-900 px-4 py-3 text-white disabled:opacity-50"
              aria-label="Send message"
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-label="Sending" />
              ) : (
                <SendHorizontal className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      <ActionConfirmDialog
        open={deleteOpen}
        title="Delete chat"
        description="This removes the conversation from your inbox view. The server keeps it for moderation and dispute handling."
        confirmLabel="Delete chat"
        busy={busy}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDeleteChat}
      />

      <ActionConfirmDialog
        open={blockOpen}
        title="Block user"
        description="Blocking stops new messages and hides future chat access from this user."
        confirmLabel="Block user"
        busy={busy}
        onClose={() => setBlockOpen(false)}
        onConfirm={confirmBlock}
      />

      <MessageReportDialog
        open={reportOpen}
        busy={busy}
        onClose={() => setReportOpen(false)}
        onSubmit={confirmReport}
      />
    </div>
  );
}
