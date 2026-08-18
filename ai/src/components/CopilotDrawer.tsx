import { useEffect, useRef, useState } from "react";
import { X, Send, Bot, RefreshCw, ShoppingBag, ArrowRight, HelpCircle, Search } from "lucide-react";
import { queryShoppingAssistant, type ShoppingAssistantResult, type ShoppingAssistantListing, type CopilotConversationMessage } from "../../lib/ai";
import { formatMoney } from "../../shared/utils/formatMoney";
import AiIcon, { shouldHideLauncher } from "./AiIcon";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  availableListings?: ShoppingAssistantListing[];
  onSelectListing?: (listingId: string) => void;
};

type AssistantMode = "ask" | "shop";

const SUGGESTED_QUERIES: Record<AssistantMode, string[]> = {
  ask: [
    "How does BuyMesho escrow and buyer protection work?",
    "How do I become a seller on BuyMesho?",
    "What can I do with my BuyMesho account?",
    "How can I manage an order or message a seller?",
  ],
  shop: [
    "Find smartphones under 250,000 MWK",
    "Find affordable fashion under 50,000 MWK",
    "Show me electronics that are currently available",
    "Find something useful for my campus budget",
  ],
};

export default function BuyMeshoCopilotDrawer({
  isOpen,
  onClose,
  availableListings,
  onSelectListing,
}: Props) {
  // Kept for compatibility with existing callers. Server-side marketplace data is authoritative.
  void availableListings;

  const [mode, setMode] = useState<AssistantMode>("ask");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<
    Array<{
      role: "user" | "assistant";
      text: string;
      result?: ShoppingAssistantResult;
    }>
  >([
    {
      role: "assistant",
      text: "Muli bwanji! I am BuyMesho Copilot. Ask me about how BuyMesho works, buying and selling, or switch to Shop to describe what you want to find.",
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      return () => clearTimeout(timer);
    }
  }, [messages, loading, isOpen]);

  useEffect(() => {
    if (isOpen) {
      const originalStyle = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isOpen]);

  if (!isOpen || shouldHideLauncher()) return null;

  const handleModeChange = (nextMode: AssistantMode) => {
    setMode(nextMode);
    setQuery("");
  };

  const handleSend = async (userText: string) => {
    const trimmed = userText.trim();
    if (!trimmed || loading) return;

    const conversation: CopilotConversationMessage[] = messages.slice(-8).map((message) => ({
      role: message.role,
      text: message.text,
    }));

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setQuery("");
    setLoading(true);

    try {
      const result = await queryShoppingAssistant({ query: trimmed });

      setMessages((prev) => [
        ...prev,
        result
          ? { role: "assistant", text: result.reply, result }
          : {
              role: "assistant",
              text: "BuyMesho Copilot is currently unavailable. No fabricated marketplace information was generated.",
            },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "BuyMesho Copilot is currently unavailable. Please try again later.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-zinc-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-5 py-3.5 text-zinc-900">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-100 p-1.5">
              <AiIcon className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold leading-tight text-zinc-900">BuyMesho Copilot</h3>
              <p className="text-xs font-semibold text-zinc-500">Ask about BuyMesho or discover products</p>
            </div>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-2xl p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900" aria-label="Close BuyMesho Copilot">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-zinc-200 bg-white p-1">
            <button type="button" onClick={() => handleModeChange("ask")} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${mode === "ask" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
              <HelpCircle className="h-4 w-4" /> Ask BuyMesho
            </button>
            <button type="button" onClick={() => handleModeChange("shop")} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${mode === "shop" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
              <Search className="h-4 w-4" /> Shop
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto bg-zinc-100 p-4">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`max-w-[88%] rounded-3xl px-4 py-3 text-sm shadow-2xs ${msg.role === "user" ? "rounded-br-xs bg-zinc-900 text-white" : "rounded-bl-xs border border-zinc-200 bg-white text-zinc-900"}`}>
                {msg.role === "assistant" && (
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-zinc-700"><Bot className="h-3.5 w-3.5 text-zinc-900" /> BuyMesho Copilot</div>
                )}
                <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>

                {msg.result?.recommended_listings?.length ? (
                  <div className="mt-3 space-y-2 border-t border-zinc-200/80 pt-3">
                    <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-zinc-500"><ShoppingBag className="h-3 w-3 text-zinc-800" /> Current BuyMesho matches</p>
                    <div className="grid gap-2">
                      {msg.result.recommended_listings.map((item) => {
                        const reason = msg.result?.match_reasons?.[String(item.id)];
                        return (
                          <button type="button" key={item.id} onClick={() => onSelectListing?.(item.id)} className="group flex items-start justify-between gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-2.5 text-left transition-all hover:border-zinc-300 hover:bg-zinc-100">
                            <span className="min-w-0 space-y-1">
                              <span className="block truncate text-xs font-bold text-zinc-900">{item.name}</span>
                              <span className="block text-xs font-extrabold text-zinc-900">{formatMoney(item.price)}</span>
                              {item.condition ? <span className="block text-[11px] text-zinc-500">Condition: {item.condition}</span> : null}
                              {reason ? <span className="block line-clamp-2 text-[11px] leading-snug text-zinc-600">{reason}</span> : null}
                            </span>
                            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:text-zinc-900" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              {msg.result?.suggested_follow_ups?.length ? (
                <div className="mt-2 flex max-w-[88%] flex-wrap justify-start gap-1.5">
                  {msg.result.suggested_follow_ups.map((prompt, pIdx) => (
                    <button key={pIdx} onClick={() => handleSend(prompt)} className="cursor-pointer rounded-full border border-emerald-300/80 bg-emerald-50/80 px-3 py-1.5 text-xs font-semibold text-emerald-950 transition-all hover:border-emerald-400 hover:bg-emerald-100/80">{prompt}</button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}

          {loading ? (
            <div className="flex w-fit animate-pulse items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-3 text-xs font-semibold text-zinc-700 shadow-2xs">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-red-900" />
              {mode === "shop" ? "Searching current BuyMesho listings…" : "Checking BuyMesho's current product guidance…"}
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>

        <div className="shrink-0 border-t border-zinc-200 bg-zinc-50/80 px-4 py-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Try asking:</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_QUERIES[mode].map((q) => (
              <button key={q} onClick={() => handleSend(q)} className="cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-left text-xs font-semibold text-zinc-700 shadow-2xs transition-all hover:border-zinc-300 hover:bg-zinc-100">{q}</button>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t border-zinc-200 bg-white p-3 sm:p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSend(query); }} className="flex items-center gap-2">
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={mode === "shop" ? "Describe what you want to buy…" : "Ask how BuyMesho works…"} className="flex-1 rounded-2xl border border-zinc-200 bg-zinc-100 px-4 py-2.5 text-sm text-zinc-900 outline-none transition-all placeholder:text-zinc-400 hover:bg-zinc-50 focus:border-black focus:bg-white focus:ring-2 focus:ring-black" />
            <button type="submit" disabled={!query.trim() || loading} className="shrink-0 cursor-pointer rounded-2xl bg-zinc-900 p-2.5 text-white transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40" aria-label={mode === "shop" ? "Search BuyMesho listings" : "Ask BuyMesho Copilot"}>
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
