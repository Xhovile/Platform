import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Loader2, MessageCircle, ShieldAlert } from "lucide-react";
import type { Conversation } from "./types";
import { useAuthUser } from "./hooks/useAuthUser";
import { navigateBackOrPath, navigateToLogin } from "./lib/appNavigation";
import { apiFetch } from "./lib/api";
import { deleteConversation, fetchInbox } from "./lib/messages";
import {
  blockConversationUser,
  markConversationSpam,
  reportConversation,
  unblockConversationUser,
} from "./lib/messageModeration";
import { navigateToConversation } from "./lib/messagesNavigation";
import ConversationActionsMenu from "./components/messages/ConversationActionsMenu";
import ActionConfirmDialog from "./components/messages/ActionConfirmDialog";

type InboxFilter = "all" | "read" | "unread";

function timeLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function sortByLatest(a: Conversation, b: Conversation) {
  return (b.last_message_at || "").localeCompare(a.last_message_at || "");
}

function FilterMenu({
  value,
  onChange,
}: {
  value: InboxFilter;
  onChange: (value: InboxFilter) => void;
}) {
  const [open, setOpen] = useState(false);

  const label = value === "all" ? "All" : value === "read" ? "Read" : "Unread";

  return (
    <div className="relative inline-block max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
      >
        {label}
        <ChevronDown className="h-4 w-4" />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl sm:right-0">
          {(["all", "read", "unread"] as InboxFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                onChange(item);
                setOpen(false);
              }}
              className={`block w-full px-4 py-3 text-left text-sm font-bold ${
                value === item ? "bg-zinc-900 text-white" : "text-zinc-800 hover:bg-zinc-50"
              }`}
            >
              {item === "all" ? "All" : item === "read" ? "Read" : "Unread"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConversationRow({
  convo,
  onOpen,
  onDelete,
  onBlock,
  onUnblock,
  onReport,
  onSpam,
}: {
  convo: Conversation;
  onOpen: () => void;
  onDelete: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onReport: () => void;
  onSpam: () => void;
}) {
  const unread = Number(convo.unread_count || 0);
  const blocked = Boolean(convo.blocked_by_you || convo.blocked_by_other);
  const threadType = String(convo.thread_type || "listing");
  const isEventThread = threadType === "event";
  const isSellerThread = threadType === "seller";
  const title = isEventThread
    ? convo.event?.title || convo.listing.name
    : isSellerThread
      ? convo.seller.business_name
      : convo.listing.name;
  const subtitle = isEventThread
    ? `Event · ${convo.event?.organizer_name || convo.seller.business_name}`
    : isSellerThread
      ? "Seller"
      : convo.seller.business_name;

  return (
    <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:bg-zinc-50">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white">
            <MessageCircle className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-zinc-900">{title}</p>
                <p className="truncate text-xs font-semibold text-zinc-500">{subtitle}</p>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-zinc-400">
                {timeLabel(convo.last_message_at)}
              </span>
            </div>

            <p className="mt-2 line-clamp-2 text-sm text-zinc-600">
              {convo.last_message_preview || "Start the conversation."}
            </p>

            {blocked ? (
              <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                <ShieldAlert className="h-3.5 w-3.5" />
                Messaging restricted
              </div>
            ) : null}

            <div className="mt-3 flex items-center justify-between gap-2">
              {unread > 0 ? (
                <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700">
                  {unread} unread
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-bold text-zinc-500">
                  Read
                </span>
              )}
              <span className="text-[11px] font-semibold text-zinc-400">Open</span>
            </div>
          </div>
        </button>

        <ConversationActionsMenu
          className="shrink-0"
          onDelete={onDelete}
          onBlock={onBlock}
          onUnblock={onUnblock}
          onReport={onReport}
          onSpam={onSpam}
          blockedByYou={Boolean(convo.blocked_by_you)}
          blockedByOther={Boolean(convo.blocked_by_other)}
        />
      </div>
    </div>
  );
}

export default function MessagesInboxPage() {
  const { user, loading: authLoading } = useAuthUser();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [inbox, setInbox] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const sellerScope = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("scope") === "seller";

  const fetchScopedInbox = async () => {
    if (!sellerScope) return fetchInbox();
    const result = await apiFetch("/api/messages/inbox?scope=seller");
    const payload = result as { items?: Conversation[] };
    return Array.isArray(payload.items) ? payload.items : [];
  };

  const loadInbox = async () => {
    const items = await fetchScopedInbox();
    setInbox(items);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigateToLogin();
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setStatus(null);
      try {
        const items = await fetchScopedInbox();
        if (!cancelled) setInbox(items);
      } catch (error: any) {
        if (!cancelled) setStatus(error?.message || "Failed to load messages.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, sellerScope]);

  const counts = useMemo(() => {
    const unread = inbox.filter((item) => Number(item.unread_count || 0) > 0).length;
    const read = inbox.length - unread;
    return { all: inbox.length, unread, read };
  }, [inbox]);

  const filteredInbox = useMemo(() => {
    const sorted = [...inbox].sort(sortByLatest);
    if (filter === "unread") return sorted.filter((item) => Number(item.unread_count || 0) > 0);
    if (filter === "read") return sorted.filter((item) => Number(item.unread_count || 0) === 0);
    return sorted;
  }, [filter, inbox]);

  const withBusy = async (conversationId: number, callback: () => Promise<void>) => {
    setBusyId(conversationId);
    try {
      await callback();
    } finally {
      setBusyId(null);
    }
  };

  const openDeleteDialog = (conversation: Conversation) => {
    setDeleteTarget(conversation);
    setDeleteOpen(true);
  };

  const confirmDeleteConversation = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await deleteConversation(deleteTarget.id);
      await loadInbox();
      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch (error: any) {
      setStatus(error?.message || "Failed to delete chat.");
    } finally {
      setBusyId(null);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100">
        <Loader2 className="h-10 w-10 animate-spin text-zinc-700" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-zinc-100/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-zinc-200 bg-white px-4 py-2.5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => navigateBackOrPath("/")}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-100"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>

              <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-zinc-400">
                Messages
              </p>

              <div className="w-[72px]" />
            </div>
          </div>
        </div>
      </header>

      <div className="pointer-events-none sticky top-[78px] z-30">
        <div className="mx-auto flex max-w-7xl justify-end px-4 pt-2 sm:px-6 lg:px-8 overflow-x-visible">
          <div className="pointer-events-auto relative">
            <FilterMenu value={filter} onChange={setFilter} />
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {status ? (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {status}
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-zinc-400">
              Conversations
            </p>
          </div>

          <div className="space-y-3">
            {filteredInbox.length ? (
              filteredInbox.map((convo) => (
                <div
                  key={convo.id}
                  className={busyId === convo.id ? "opacity-60 pointer-events-none" : ""}
                >
                  <ConversationRow
                    convo={convo}
                    onOpen={() => navigateToConversation(convo.id)}
                    onDelete={() => openDeleteDialog(convo)}
                    onBlock={() => {
                      void withBusy(convo.id, async () => {
                        await blockConversationUser(convo.id, { scope: "messages" });
                        await loadInbox();
                      });
                    }}
                    onUnblock={() => {
                      void withBusy(convo.id, async () => {
                        await unblockConversationUser(convo.id);
                        await loadInbox();
                      });
                    }}
                    onReport={() => {
                      void withBusy(convo.id, async () => {
                        await reportConversation(convo.id, {
                          reason: "spam",
                          details: "Reported from inbox actions",
                        });
                        setStatus("Conversation reported for moderation review.");
                      });
                    }}
                    onSpam={() => {
                      void withBusy(convo.id, async () => {
                        await markConversationSpam(convo.id);
                        setStatus("Conversation flagged as spam.");
                      });
                    }}
                  />
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
                {filter === "unread"
                  ? "No unread messages right now."
                  : filter === "read"
                    ? "No read conversations yet."
                    : "No messages yet. Open a listing and tap Message in app to start."}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-bold text-zinc-500">
            <span className="rounded-full bg-white px-3 py-2 text-center shadow-sm">All {counts.all}</span>
            <span className="rounded-full bg-white px-3 py-2 text-center shadow-sm">Unread {counts.unread}</span>
            <span className="rounded-full bg-white px-3 py-2 text-center shadow-sm">Read {counts.read}</span>
          </div>
        </div>
      </main>

      <ActionConfirmDialog
        open={deleteOpen}
        title="Delete chat"
        description="This removes the conversation from your inbox view. The server keeps it for moderation and dispute handling."
        confirmLabel="Delete chat"
        busy={busyId !== null}
        onClose={() => {
          setDeleteOpen(false);
          setDeleteTarget(null);
        }}
        onConfirm={confirmDeleteConversation}
      />
    </div>
  );
}
