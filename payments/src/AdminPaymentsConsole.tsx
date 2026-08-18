import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BadgeInfo,
  CircleAlert,
  CreditCard,
  Loader2,
  ShieldCheck,
  Webhook,
  X,
} from "lucide-react";
import { apiFetch } from "./lib/api";
import AdminWorkspaceLayout from "./modules/admin/AdminWorkspaceLayout";

type PaymentRow = {
  id: string;
  order_id: string;
  provider: string;
  method: string;
  payment_status: string;
  reference: string;
  provider_reference: string | null;
  currency: string;
  amount: number;
  checkout_url: string | null;
  paid_at: string | null;
  verified: number;
  verification: string | null;
  created_at: string;
  updated_at: string;
  order_status: string | null;
  order_paid_at: string | null;
  order_fulfilled_at: string | null;
  escrow_id: string | null;
  escrow_state: string | null;
  balance_amount: number | null;
  balance_currency: string | null;
  escrow_updated_at: string | null;
};

type WebhookEventRow = {
  id: number;
  provider: string;
  reference: string | null;
  event_type: string | null;
  signature_valid: number;
  payload: string | null;
  created_at: string;
};

type SummaryResponse = {
  summary?: {
    total_payments?: number;
    verified_payments?: number;
    paid_payments?: number;
    pending_payments?: number;
  };
  webhookSummary?: {
    total_webhooks?: number;
    valid_webhooks?: number;
    invalid_webhooks?: number;
  };
};

type Tone = "zinc" | "emerald" | "amber" | "rose" | "blue";
type LifecycleState = "done" | "active" | "waiting" | "issue";
type PaymentSortMode = "recent" | "verified" | "paid" | "pending";
type WebhookSortMode = "recent" | "valid" | "invalid";

type LifecycleStep = {
  number: number;
  title: string;
  detail: string;
  state: LifecycleState;
};

const TONE_CLASSES: Record<Tone, string> = {
  zinc: "bg-zinc-100 text-zinc-700 border-zinc-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
};

const PAYMENT_SORTS: Array<{ key: PaymentSortMode; label: string }> = [
  { key: "recent", label: "Recent" },
  { key: "verified", label: "Verified" },
  { key: "paid", label: "Paid" },
  { key: "pending", label: "Pending" },
];

const WEBHOOK_SORTS: Array<{ key: WebhookSortMode; label: string }> = [
  { key: "recent", label: "Recent" },
  { key: "valid", label: "Valid hooks" },
  { key: "invalid", label: "Invalid hooks" },
];

function toText(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" ? serialized : fallback;
  } catch {
    return fallback;
  }
}

function token(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : toText(value, "").toLowerCase();
}

function formatDate(value?: unknown): string {
  if (!value) return "—";
  try {
    return new Date(String(value)).toLocaleString();
  } catch {
    return toText(value);
  }
}

function normalizeStatusLabel(value: unknown): string {
  const label = toText(value, "");
  return label ? label.replace(/_/g, " ") : "—";
}

function paymentTone(status: unknown): Tone {
  const s = token(status);
  if (["captured", "paid"].includes(s)) return "emerald";
  if (s === "pending") return "amber";
  if (["failed", "cancelled"].includes(s)) return "rose";
  return "zinc";
}

function orderTone(status: unknown): Tone {
  const s = token(status);
  if (!s) return "zinc";
  if (s === "fulfilled") return "emerald";
  if (s === "refunded") return "rose";
  if (["paid", "in_escrow", "pending_payment"].includes(s)) return "blue";
  if (s === "disputed") return "amber";
  return "zinc";
}

function escrowTone(status: unknown): Tone {
  const s = token(status);
  if (!s) return "zinc";
  if (s === "released") return "emerald";
  if (s === "refunded") return "rose";
  if (s === "disputed") return "amber";
  if (["initiated", "funded", "held"].includes(s)) return "blue";
  return "zinc";
}

function lifecycleTone(state: LifecycleState): Tone {
  if (state === "done") return "emerald";
  if (state === "active") return "blue";
  if (state === "issue") return "rose";
  return "zinc";
}

function StatusPill({ label, tone = "zinc" }: { label: string; tone?: Tone }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${TONE_CLASSES[tone]}`}>{label}</span>;
}

function StatButton({ label, value, active, onClick, badge = "Sort" }: { label: string; value: number; active: boolean; onClick: () => void; badge?: string; }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group flex min-h-[5.75rem] flex-col justify-between rounded-2xl border px-3.5 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:px-4 ${
        active
          ? "border-zinc-950 bg-zinc-950 text-white shadow-zinc-950/15"
          : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-[11px] font-black uppercase tracking-[0.2em] ${active ? "text-zinc-300" : "text-zinc-500"}`}>{label}</p>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] ${active ? "bg-white/15 text-white" : "bg-zinc-100 text-zinc-500 group-hover:bg-zinc-200/70"}`}>{badge}</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-2xl font-black leading-none tracking-tight sm:text-3xl">{value}</p>
        <span className={`h-1.5 w-8 rounded-full ${active ? "bg-white/60" : "bg-zinc-200 group-hover:bg-zinc-300"}`} />
      </div>
    </button>
  );
}

function sortPayments(payments: PaymentRow[], mode: PaymentSortMode) {
  return [...payments].sort((left, right) => {
    const leftTime = Date.parse(left.updated_at || left.created_at || "");
    const rightTime = Date.parse(right.updated_at || right.created_at || "");

    const leftRank =
      mode === "verified"
        ? Number(left.verified) === 1 ? 0 : 1
        : mode === "paid"
          ? ["paid", "captured"].includes(token(left.payment_status)) ? 0 : 1
          : mode === "pending"
            ? token(left.payment_status) === "pending" ? 0 : 1
            : 0;
    const rightRank =
      mode === "verified"
        ? Number(right.verified) === 1 ? 0 : 1
        : mode === "paid"
          ? ["paid", "captured"].includes(token(right.payment_status)) ? 0 : 1
          : mode === "pending"
            ? token(right.payment_status) === "pending" ? 0 : 1
            : 0;

    if (leftRank !== rightRank) return leftRank - rightRank;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.reference.localeCompare(right.reference);
  });
}

function sortWebhooks(events: WebhookEventRow[], mode: WebhookSortMode) {
  return [...events].sort((left, right) => {
    const leftTime = Date.parse(left.created_at || "");
    const rightTime = Date.parse(right.created_at || "");

    const leftRank = mode === "valid" ? (Number(left.signature_valid) === 1 ? 0 : 1) : mode === "invalid" ? (Number(left.signature_valid) === 1 ? 1 : 0) : 0;
    const rightRank = mode === "valid" ? (Number(right.signature_valid) === 1 ? 0 : 1) : mode === "invalid" ? (Number(right.signature_valid) === 1 ? 1 : 0) : 0;

    if (leftRank !== rightRank) return leftRank - rightRank;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.id - right.id;
  });
}

function buildLifecycleSteps(payment?: PaymentRow | null, hooks: WebhookEventRow[] = []): LifecycleStep[] {
  const hasPayment = !!payment;
  const hasCheckout = !!payment?.checkout_url;
  const hasWebhook = hooks.length > 0;
  const hasValidWebhook = hooks.some((hook) => Number(hook.signature_valid) === 1);
  const isPaid = !!payment && (["paid", "captured"].includes(token(payment.payment_status)) || !!payment.paid_at);
  const isEscrowActive = !!payment && (["in_escrow", "paid"].includes(token(payment.order_status)) || !!payment.escrow_id);
  const isDelivered = !!payment && token(payment.order_status) === "fulfilled";
  const isSettled = !!payment && ["released", "refunded"].includes(token(payment.escrow_state));
  const isDisputed = !!payment && token(payment.escrow_state) === "disputed";

  return [
    { number: 1, title: "Payment created", detail: hasPayment ? "BuyMesho stored a payment row for this checkout attempt." : "No payment row exists yet.", state: hasPayment ? "done" : "waiting" },
    { number: 2, title: "Checkout opened", detail: hasCheckout ? "The buyer was sent to the provider checkout URL." : "Waiting for checkout creation.", state: hasCheckout ? "done" : hasPayment ? "active" : "waiting" },
    { number: 3, title: "Webhook received", detail: hasWebhook ? "PayChangu callback delivery was captured." : "No webhook event has arrived yet.", state: hasWebhook ? "active" : "waiting" },
    { number: 4, title: "Signature verified", detail: hasValidWebhook ? "At least one webhook signature passed verification." : hasWebhook ? "Webhook arrived, but verification has not passed yet." : "Waiting for a webhook to verify.", state: hasValidWebhook ? "done" : hasWebhook ? "active" : "waiting" },
    { number: 5, title: "Order confirmed", detail: isPaid ? "The order was marked paid and moved into the confirmed flow." : "The order is still pending confirmation.", state: isPaid ? "done" : "waiting" },
    { number: 6, title: "Escrow active", detail: isEscrowActive ? "Funds are represented as active escrow for the order." : "Escrow has not started yet.", state: isEscrowActive ? (isDisputed ? "issue" : "active") : "waiting" },
    { number: 7, title: "Buyer confirmed delivery", detail: isDelivered ? "The order has been marked fulfilled after delivery confirmation." : "Waiting for delivery confirmation.", state: isDelivered ? "done" : "waiting" },
    { number: 8, title: "Funds released or refunded", detail: isSettled ? (token(payment?.escrow_state) === "released" ? "Funds were released to the seller." : "Funds were refunded to the buyer.") : "Final settlement has not happened yet.", state: token(payment?.escrow_state) === "released" ? "done" : token(payment?.escrow_state) === "refunded" ? "issue" : "waiting" },
  ];
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="break-all font-semibold text-zinc-900">{value}</span>
    </div>
  );
}

function PaymentDrawer({ payment, hooks, onClose }: { payment: PaymentRow; hooks: WebhookEventRow[]; onClose: () => void; }) {
  return (
    <div className="fixed inset-0 z-[90] flex bg-zinc-900/50 backdrop-blur-sm" onClick={onClose}>
      <aside className="ml-auto h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-100 bg-white px-5 py-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Payment detail</p>
            <h3 className="mt-1 text-lg font-black text-zinc-950">{toText(payment.reference)}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-zinc-200 p-2 hover:bg-zinc-50">
            <X className="h-5 w-5 text-zinc-500" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <section className="rounded-[2rem] border border-zinc-200 bg-zinc-50 p-5">
            <h4 className="text-base font-black">Core fields</h4>
            <div className="mt-4 grid gap-3">
              <Row label="BuyMesho reference" value={toText(payment.reference)} />
              <Row label="Gateway reference" value={toText(payment.provider_reference) || "Not returned by provider"} />
              <Row label="Payment status" value={<StatusPill label={normalizeStatusLabel(payment.payment_status)} tone={paymentTone(payment.payment_status)} />} />
              <Row label="Order status" value={<StatusPill label={normalizeStatusLabel(payment.order_status)} tone={orderTone(payment.order_status)} />} />
              <Row label="Escrow status" value={<StatusPill label={normalizeStatusLabel(payment.escrow_state)} tone={escrowTone(payment.escrow_state)} />} />
              <Row label="Amount" value={`${payment.currency} ${Number(payment.amount).toLocaleString()}`} />
              <Row label="Order ID" value={toText(payment.order_id)} />
              <Row label="Provider" value={toText(payment.provider)} />
              <Row label="Method" value={toText(payment.method)} />
              <Row label="Verified" value={Number(payment.verified) === 1 ? "yes" : "no"} />
            </div>
          </section>

          <section className="rounded-[2rem] border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              <h4 className="text-base font-black">Lifecycle snapshot</h4>
            </div>
            <div className="mt-4 grid gap-3">
              {buildLifecycleSteps(payment, hooks).map((step) => (
                <div key={step.number} className={`rounded-2xl border p-4 ${step.state === "done" ? "border-emerald-200 bg-emerald-50/70" : step.state === "active" ? "border-blue-200 bg-blue-50/70" : step.state === "issue" ? "border-rose-200 bg-rose-50/70" : "border-zinc-200 bg-white"}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 font-black text-zinc-900 shadow-sm">{step.number}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h5 className="text-sm font-black tracking-tight text-zinc-900">{step.title}</h5>
                        <StatusPill label={step.state === "done" ? "Done" : step.state === "active" ? "Active" : step.state === "issue" ? "Issue" : "Waiting"} tone={lifecycleTone(step.state)} />
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{step.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              <h4 className="text-base font-black">Webhook history for this reference</h4>
            </div>
            <div className="mt-4 space-y-3">
              {hooks.length ? hooks.map((hook) => (
                <div key={hook.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black text-zinc-900">{toText(hook.event_type)}</p>
                    <StatusPill label={Number(hook.signature_valid) === 1 ? "Valid" : "Invalid"} tone={Number(hook.signature_valid) === 1 ? "emerald" : "rose"} />
                  </div>
                  <p className="mt-2 break-all font-mono text-xs text-zinc-500">{toText(hook.reference)}</p>
                  <p className="mt-2 text-xs text-zinc-500">{formatDate(hook.created_at)}</p>
                </div>
              )) : <p className="text-sm text-zinc-500">No webhook rows match this reference.</p>}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

export default function AdminPaymentsConsole() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventRow[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"payments" | "webhooks">("payments");
  const [selectedReference, setSelectedReference] = useState<string | null>(null);
  const [paymentSortMode, setPaymentSortMode] = useState<PaymentSortMode>("recent");
  const [webhookSortMode, setWebhookSortMode] = useState<WebhookSortMode>("recent");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setError(null);
      setRefreshing(true);
      try {
        const [paymentsData, webhookData, summaryData] = await Promise.all([
          apiFetch("/api/admin/payments"),
          apiFetch("/api/admin/webhook-events"),
          apiFetch("/api/admin/payment-summary"),
        ]);
        if (!mounted) return;
        setPayments(Array.isArray(paymentsData) ? paymentsData : []);
        setWebhookEvents(Array.isArray(webhookData) ? webhookData : []);
        setSummary((summaryData ?? {}) as SummaryResponse);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load payment monitoring data.");
      } finally {
        if (mounted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(
    () => ({
      totalPayments: summary?.summary?.total_payments ?? payments.length,
      verifiedPayments: summary?.summary?.verified_payments ?? payments.filter((p) => Number(p.verified) === 1).length,
      paidPayments: summary?.summary?.paid_payments ?? payments.filter((p) => ["paid", "captured"].includes(token(p.payment_status))).length,
      pendingPayments: summary?.summary?.pending_payments ?? payments.filter((p) => token(p.payment_status) === "pending").length,
      totalWebhooks: summary?.webhookSummary?.total_webhooks ?? webhookEvents.length,
      validWebhooks: summary?.webhookSummary?.valid_webhooks ?? webhookEvents.filter((e) => Number(e.signature_valid) === 1).length,
      invalidWebhooks: summary?.webhookSummary?.invalid_webhooks ?? webhookEvents.filter((e) => Number(e.signature_valid) === 0).length,
    }),
    [payments, webhookEvents, summary],
  );

  const latestPayment = useMemo(() => {
    return [...payments].sort((a, b) => Date.parse(b.updated_at || b.created_at || "") - Date.parse(a.updated_at || a.created_at || ""))[0] ?? null;
  }, [payments]);

  const selectedPayment = payments.find((p) => p.reference === selectedReference) ?? null;
  const selectedHooks = selectedReference ? webhookEvents.filter((e) => e.reference === selectedReference) : [];

  const sortedPayments = useMemo(() => sortPayments(payments, paymentSortMode), [payments, paymentSortMode]);
  const sortedWebhookEvents = useMemo(() => sortWebhooks(webhookEvents, webhookSortMode), [webhookEvents, webhookSortMode]);

  const activeSortLabel =
    activeTab === "payments"
      ? paymentSortMode === "recent"
        ? "Recent"
        : paymentSortMode === "verified"
          ? "Verified"
          : paymentSortMode === "paid"
            ? "Paid"
            : "Pending"
      : webhookSortMode === "recent"
        ? "Recent"
        : webhookSortMode === "valid"
          ? "Valid hooks"
          : "Invalid hooks";

  const lifecycleSteps = useMemo(() => buildLifecycleSteps(selectedPayment ?? latestPayment, selectedPayment ? selectedHooks : latestPayment ? webhookEvents.filter((event) => event.reference === latestPayment.reference) : webhookEvents), [selectedPayment, latestPayment, webhookEvents, selectedHooks]);

  return (
    <AdminWorkspaceLayout
      title="Payments & Webhooks"
      description="Admin monitoring only. Buyer order status belongs elsewhere."
      onRefresh={() => window.location.reload()}
    >
      <main className="space-y-8">
        <section className="grid w-full grid-cols-2 gap-3 sm:w-80">
          <StatButton label="Payments" value={stats.totalPayments} active={activeTab === "payments"} onClick={() => setActiveTab("payments")} badge="View" />
          <StatButton label="Webhooks" value={stats.totalWebhooks} active={activeTab === "webhooks"} onClick={() => setActiveTab("webhooks")} badge="View" />
        </section>

        {latestPayment ? (
          <section className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              <h2 className="text-lg font-black">Latest Transaction Lifecycle</h2>
            </div>
            <p className="mt-2 text-sm text-zinc-600">Showing latest order reference: {toText(latestPayment.reference)}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {lifecycleSteps.map((step) => (
                <div key={step.number} className={`rounded-2xl border p-4 shadow-sm ${step.state === "done" ? "border-emerald-200 bg-emerald-50/70" : step.state === "active" ? "border-blue-200 bg-blue-50/70" : step.state === "issue" ? "border-rose-200 bg-rose-50/70" : "border-zinc-200 bg-white"}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 font-black text-zinc-900 shadow-sm">{step.number}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-black tracking-tight text-zinc-900">{step.title}</h3>
                        <StatusPill label={step.state === "done" ? "Done" : step.state === "active" ? "Active" : step.state === "issue" ? "Issue" : "Waiting"} tone={lifecycleTone(step.state)} />
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{step.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-500">Click to Sort</p>
            <p className="mt-1 text-sm text-zinc-600">Current sort: <span className="font-bold text-zinc-900">{activeSortLabel}</span></p>
          </div>

          {activeTab === "payments" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PAYMENT_SORTS.map((item) => (
                <StatButton key={item.key} label={item.label} value={item.key === "recent" ? stats.totalPayments : item.key === "verified" ? stats.verifiedPayments : item.key === "paid" ? stats.paidPayments : stats.pendingPayments} active={paymentSortMode === item.key} onClick={() => setPaymentSortMode(item.key)} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {WEBHOOK_SORTS.map((item) => (
                <StatButton key={item.key} label={item.label} value={item.key === "recent" ? stats.totalWebhooks : item.key === "valid" ? stats.validWebhooks : stats.invalidWebhooks} active={webhookSortMode === item.key} onClick={() => setWebhookSortMode(item.key)} />
              ))}
            </div>
          )}
        </section>

        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        {activeTab === "payments" ? (
          <section className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                <h2 className="text-lg font-black">Payment records</h2>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" /></div>
            ) : sortedPayments.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">No payments found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-zinc-500">
                    <tr>
                      <th className="p-4 text-left">Reference</th>
                      <th className="p-4 text-left">Payment</th>
                      <th className="p-4 text-left">Order</th>
                      <th className="p-4 text-left">Escrow</th>
                      <th className="p-4 text-left">Amount</th>
                      <th className="p-4 text-left">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPayments.map((payment) => (
                      <tr key={payment.id} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50" onClick={() => setSelectedReference(payment.reference)}>
                        <td className="p-4"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">BuyMesho reference</p><p className="mt-1 break-all font-mono text-xs">{toText(payment.reference)}</p><p className="mt-2 text-[11px] text-zinc-400">{toText(payment.provider)}</p></td>
                        <td className="p-4"><StatusPill label={normalizeStatusLabel(payment.payment_status)} tone={paymentTone(payment.payment_status)} /><div className="mt-2 text-xs text-zinc-500">{toText(payment.method)}</div><div className="mt-1 text-[11px] text-zinc-400">Verified: {Number(payment.verified) === 1 ? "yes" : "no"}</div></td>
                        <td className="p-4"><StatusPill label={normalizeStatusLabel(payment.order_status)} tone={orderTone(payment.order_status)} /><div className="mt-2 break-all text-xs text-zinc-500">{toText(payment.order_id)}</div><div className="mt-1 text-[11px] text-zinc-400">Order paid: {formatDate(payment.order_paid_at)}</div></td>
                        <td className="p-4"><StatusPill label={normalizeStatusLabel(payment.escrow_state)} tone={escrowTone(payment.escrow_state)} /><div className="mt-2 text-xs text-zinc-500">{payment.escrow_id || "No escrow yet"}</div><div className="mt-1 text-[11px] text-zinc-400">Escrow updated: {formatDate(payment.escrow_updated_at)}</div></td>
                        <td className="p-4"><div className="font-bold">{payment.currency} {payment.amount}</div><div className="mt-1 text-[11px] text-zinc-400">Gateway reference: {toText(payment.provider_reference)}</div></td>
                        <td className="p-4 text-xs text-zinc-500">{formatDate(payment.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <section className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <Webhook className="h-5 w-5" />
                <h2 className="text-lg font-black">Webhook log</h2>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" /></div>
            ) : sortedWebhookEvents.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">No webhook events captured yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-zinc-500">
                    <tr>
                      <th className="p-4 text-left">Event</th>
                      <th className="p-4 text-left">Reference</th>
                      <th className="p-4 text-left">Signature</th>
                      <th className="p-4 text-left">Received</th>
                      <th className="p-4 text-left">Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedWebhookEvents.map((event) => (
                      <tr key={event.id} className="border-t border-zinc-100">
                        <td className="p-4 align-top">{toText(event.event_type)}</td>
                        <td className="p-4 align-top font-mono text-xs break-all">{toText(event.reference)}</td>
                        <td className="p-4 align-top">{Number(event.signature_valid) === 1 ? <StatusPill label="Valid" tone="emerald" /> : <StatusPill label="Invalid" tone="rose" />}</td>
                        <td className="p-4 align-top text-zinc-500">{formatDate(event.created_at)}</td>
                        <td className="p-4 align-top">{event.payload ? <details className="group"><summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-bold text-zinc-700"><BadgeInfo className="h-3.5 w-3.5" />View payload</summary><pre className="mt-3 max-h-72 overflow-auto rounded-2xl bg-zinc-950 p-4 text-[11px] leading-relaxed text-zinc-100">{event.payload}</pre></details> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700"><ShieldCheck className="h-5 w-5" /></div>
            <div className="space-y-2">
              <p className="text-sm font-black text-zinc-900">How to read this page</p>
              <p className="text-sm leading-relaxed text-zinc-600">Pending means the payment has been created, but the webhook or verification step has not completed yet. Once confirmed, the order should move through paid and into escrow, and later to released or refunded.</p>
              <p className="text-sm leading-relaxed text-zinc-600">Seller-facing payout wording remains: Queued for admin review → Sent to PayChangu → Provider pending → Paid (or Needs destination update).</p>
              <p className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700"><CircleAlert className="h-3.5 w-3.5" />Escrow control should stay in the order flow, not the admin page.</p>
            </div>
          </div>
        </section>
      </main>

      {selectedPayment ? <PaymentDrawer payment={selectedPayment} hooks={selectedHooks} onClose={() => setSelectedReference(null)} /> : null}
    </AdminWorkspaceLayout>
  );
}
