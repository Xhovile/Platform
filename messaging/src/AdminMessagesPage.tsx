import { useEffect, useState } from "react";
import { AlertTriangle, Ban, ChevronRight, Loader2, MessageSquareText, Search, ShieldAlert } from "lucide-react";
import AdminWorkspaceLayout from "./modules/admin/AdminWorkspaceLayout";
import { navigateToPath } from "./lib/appNavigation";
import { apiFetch } from "./lib/api";

type Filter = "Unread" | "Reported" | "Blocked" | "All";
type AdminConversation = {
  id: number;
  listing_id: number | null;
  event_id: number | null;
  thread_type: "event" | "listing" | "seller";
  buyer: { uid: string; email: string | null; business_name: string | null };
  seller: { uid: string; email: string | null; business_name: string | null };
  listing: { id: number; name: string } | null;
  event: { id: number; title: string; organizer_name: string } | null;
  last_message_preview: string;
  last_message_at: string | null;
  updated_at: string | null;
  open_report_count: number;
  is_blocked: boolean;
  is_restricted: boolean;
  is_unread: boolean;
};

type Summary = { unread: number; reported: number; blocked: number };
const FILTERS: Filter[] = ["Unread", "Reported", "Blocked", "All"];

function timeLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export default function AdminMessagesPage() {
  const [filter, setFilter] = useState<Filter>("Unread");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AdminConversation[]>([]);
  const [summary, setSummary] = useState<Summary>({ unread: 0, reported: 0, blocked: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ filter: filter.toLowerCase(), limit: "50" });
        if (query.trim()) params.set("search", query.trim());
        const payload = await apiFetch(`/api/admin/messages?${params.toString()}`, { signal: controller.signal });
        if (!cancelled) {
          setItems(Array.isArray(payload?.items) ? payload.items : []);
          setNextCursor(payload?.pagination?.nextCursor ?? null);
          setCursorStack([]);
        }
      } catch (err: any) {
        if (cancelled || err?.name === "AbortError") return;
        setError(err?.message || "Failed to load admin messages.");
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [filter, query]);

  useEffect(() => {
    const loadSummary = async () => {
      try {
        const payload = await apiFetch("/api/admin/messages/summary");
        setSummary({ unread: Number(payload?.unread || 0), reported: Number(payload?.reported || 0), blocked: Number(payload?.blocked || 0) });
      } catch {
        // Indicators are supplementary; the main inbox remains usable.
      }
    };
    void loadSummary();
  }, [items.length]);

  const loadNextPage = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ filter: filter.toLowerCase(), limit: "50", cursor: nextCursor });
      if (query.trim()) params.set("search", query.trim());
      const payload = await apiFetch(`/api/admin/messages?${params.toString()}`);
      setCursorStack((stack) => [...stack, nextCursor]);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setNextCursor(payload?.pagination?.nextCursor ?? null);
    } catch (err: any) {
      setError(err?.message || "Failed to load next page.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminWorkspaceLayout title="Messages" description="Monitor marketplace conversations without becoming a participant in them.">
      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-zinc-400">Messages</p><p className="mt-1 text-2xl font-black text-zinc-900">{summary.unread}</p><p className="text-xs text-zinc-500">unread for admin review</p></div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-zinc-400">Reports</p><p className="mt-1 text-2xl font-black text-amber-700">{summary.reported}</p><p className="text-xs text-zinc-500">open/reviewed cases</p></div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-zinc-400">Blocked</p><p className="mt-1 text-2xl font-black text-red-700">{summary.blocked}</p><p className="text-xs text-zinc-500">conversation threads</p></div>
        </div>

        <div className="rounded-[1.75rem] border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <label htmlFor="admin-message-search" className="sr-only">Search messages</label>
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <Search className="h-5 w-5 shrink-0 text-zinc-400" />
            <input id="admin-message-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search UUID, email, business, listing, event, conversation ID..." className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-zinc-900 outline-none placeholder:text-zinc-400" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {FILTERS.map((item) => {
              const active = filter === item;
              return <button key={item} type="button" onClick={() => setFilter(item)} className={`rounded-2xl px-4 py-2.5 text-sm font-black transition-colors ${active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}>{item}</button>;
            })}
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-56 items-center justify-center rounded-[1.75rem] border border-zinc-200 bg-white shadow-sm"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" aria-label="Loading conversations" /></div>
        ) : error ? (
          <div className="rounded-[1.75rem] border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">{error}</div>
        ) : items.length ? (
          <>
            <div className="space-y-3">
              {items.map((conversation) => {
                const buyerName = conversation.buyer.business_name || conversation.buyer.email || conversation.buyer.uid;
                const sellerName = conversation.seller.business_name || conversation.seller.email || conversation.seller.uid;
                const context = conversation.listing ? `Listing · ${conversation.listing.name}` : conversation.event ? `Event · ${conversation.event.title}` : "Seller conversation";
                return (
                  <button key={conversation.id} type="button" onClick={() => navigateToPath(`/admin/messages?conversation=${conversation.id}`)} className="block w-full rounded-[1.75rem] border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-zinc-300 hover:shadow-md">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <div><p className="truncate text-base font-black text-zinc-900">{buyerName}</p><p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-400">Buyer</p></div>
                          <span className="text-zinc-300" aria-hidden="true">↔</span>
                          <div><p className="truncate text-base font-black text-zinc-900">{sellerName}</p><p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-400">{conversation.thread_type === "event" ? "Organizer" : "Seller"}</p></div>
                        </div>
                        <p className="mt-4 text-sm leading-6 text-zinc-700">{conversation.last_message_preview || "No message preview available."}</p>
                        <p className="mt-2 text-xs font-bold text-zinc-400">{context}</p>
                        <p className="mt-1 text-[11px] font-semibold text-zinc-400">Conversation #{conversation.id} · {timeLabel(conversation.last_message_at || conversation.updated_at)}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {conversation.is_unread ? <span className="rounded-full bg-zinc-900 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-white">Unread</span> : null}
                        {conversation.open_report_count > 0 ? <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />Reported {conversation.open_report_count}</span> : null}
                        {conversation.is_blocked ? <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-red-800"><Ban className="h-3.5 w-3.5" />Blocked</span> : null}
                        {conversation.is_restricted ? <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-blue-800"><ShieldAlert className="h-3.5 w-3.5" />Restricted</span> : null}
                        <ChevronRight className="mt-1 h-5 w-5 text-zinc-300" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm">
              <span className="font-semibold text-zinc-500">50 conversations per page</span>
              <button type="button" disabled={!nextCursor || loading} onClick={() => void loadNextPage()} className="rounded-xl bg-zinc-900 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Next page</button>
            </div>
          </>
        ) : (
          <div className="rounded-[1.75rem] border border-dashed border-zinc-300 bg-white p-8 text-center shadow-sm sm:p-12">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500"><MessageSquareText className="h-6 w-6" /></div>
            <p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-zinc-400">{filter} conversations</p>
            <h2 className="mt-2 text-xl font-black tracking-tight text-zinc-900">No conversations found</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-600">{query.trim() ? `Nothing matched “${query.trim()}”.` : `There are no ${filter.toLowerCase()} conversations to review right now.`}</p>
          </div>
        )}
      </section>
    </AdminWorkspaceLayout>
  );
}
