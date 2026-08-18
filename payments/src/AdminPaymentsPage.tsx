import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Webhook,
  CreditCard,
  BadgeInfo,
  CircleAlert,
} from "lucide-react";
import { apiFetch } from "./lib/api";
import { navigateToAdmin } from "./lib/appNavigation";
import AdminPayoutQueue from "./AdminPayoutQueue";

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

type PaymentSortMode = "recent" | "verified" | "paid" | "pending";
type WebhookSortMode = "recent" | "valid" | "invalid";

function StatCard({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: number;
  tone?: "zinc" | "emerald" | "amber" | "blue" | "rose";
}) {
  const toneClass: Record<typeof tone, string> = {
    zinc: "text-zinc-900",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    blue: "text-blue-700",
    rose: "text-rose-700",
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-zinc-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-black tracking-tight ${toneClass[tone]}`}>
        {value}
      </p>
    </div>
  );
}

function StatusPill({
  label,
  tone = "zinc",
}: {
  label: string;
  tone?: "zinc" | "emerald" | "amber" | "rose" | "blue";
}) {
  const toneClass: Record<typeof tone, string> = {
    zinc: "bg-zinc-100 text-zinc-700 border-zinc-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${toneClass[tone]}`}
    >
      {label}
    </span>
  );
}

function LifecycleNode({
  label,
  active,
  note,
}: {
  label: string;
  active: boolean;
  note?: string;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        active
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-200 bg-white text-zinc-700"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-black">{label}</p>
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            active ? "bg-white" : "bg-zinc-300"
          }`}
        />
      </div>
      {note ? (
        <p
          className={`mt-2 text-xs leading-5 ${
            active ? "text-zinc-200" : "text-zinc-500"
          }`}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

const toTimestamp = (value: string | null | undefined) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isPaidPayment = (payment: PaymentRow) => ["paid", "captured"].includes(payment.payment_status);
const isPendingPayment = (payment: PaymentRow) => payment.payment_status === "pending";
const isVerifiedPayment = (payment: PaymentRow) => Number(payment.verified) === 1;
const isValidWebhook = (event: WebhookEventRow) => Number(event.signature_valid) === 1;

function sortPayments(payments: PaymentRow[], mode: PaymentSortMode) {
  const ranked = [...payments];
  ranked.sort((left, right) => {
    const leftTime = toTimestamp(left.updated_at);
    const rightTime = toTimestamp(right.updated_at);

    let leftRank = 0;
    let rightRank = 0;

    if (mode === "verified") {
      leftRank = isVerifiedPayment(left) ? 0 : 1;
      rightRank = isVerifiedPayment(right) ? 0 : 1;
    } else if (mode === "paid") {
      leftRank = isPaidPayment(left) ? 0 : 1;
      rightRank = isPaidPayment(right) ? 0 : 1;
    } else if (mode === "pending") {
      leftRank = isPendingPayment(left) ? 0 : 1;
      rightRank = isPendingPayment(right) ? 0 : 1;
    }

    if (leftRank !== rightRank) return leftRank - rightRank;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.reference.localeCompare(right.reference);
  });
  return ranked;
}

function sortWebhooks(events: WebhookEventRow[], mode: WebhookSortMode) {
  const ranked = [...events];
  ranked.sort((left, right) => {
    const leftTime = toTimestamp(left.created_at);
    const rightTime = toTimestamp(right.created_at);

    let leftRank = 0;
    let rightRank = 0;

    if (mode === "valid") {
      leftRank = isValidWebhook(left) ? 0 : 1;
      rightRank = isValidWebhook(right) ? 0 : 1;
    } else if (mode === "invalid") {
      leftRank = isValidWebhook(left) ? 1 : 0;
      rightRank = isValidWebhook(right) ? 1 : 0;
    }

    if (leftRank !== rightRank) return leftRank - rightRank;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.id - right.id;
  });
  return ranked;
}

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventRow[]>([]);
  const [summary, setSummary] = useState<SummaryResponse>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"payments" | "webhooks">("payments");
  const [paymentSortMode, setPaymentSortMode] = useState<PaymentSortMode>("recent");
  const [webhookSortMode, setWebhookSortMode] = useState<WebhookSortMode>("recent");

  const load = async () => {
    setError(null);
    setRefreshing(true);

    try {
      const [paymentsData, webhookData, summaryData] = await Promise.all([
        apiFetch("/api/admin/payments"),
        apiFetch("/api/admin/webhook-events"),
        apiFetch("/api/admin/payment-summary"),
      ]);

      setPayments(Array.isArray(paymentsData) ? paymentsData : []);
      setWebhookEvents(Array.isArray(webhookData) ? webhookData : []);
      setSummary((summaryData ?? {}) as SummaryResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load payment monitoring data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(
    () => ({
      totalPayments: summary?.summary?.total_payments ?? payments.length,
      verifiedPayments:
        summary?.summary?.verified_payments ??
        payments.filter((p) => Number(p.verified) === 1).length,
      paidPayments:
        summary?.summary?.paid_payments ??
        payments.filter((p) => ["paid", "captured"].includes(p.payment_status)).length,
      pendingPayments:
        summary?.summary?.pending_payments ??
        payments.filter((p) => p.payment_status === "pending").length,
      totalWebhooks: summary?.webhookSummary?.total_webhooks ?? webhookEvents.length,
      validWebhooks:
        summary?.webhookSummary?.valid_webhooks ??
        webhookEvents.filter((e) => Number(e.signature_valid) === 1).length,
      invalidWebhooks:
        summary?.webhookSummary?.invalid_webhooks ??
        webhookEvents.filter((e) => Number(e.signature_valid) === 0).length,
    }),
    [payments, webhookEvents, summary]
  );

  const latestPayment = payments[0] ?? null;

  const lifecycle = latestPayment
    ? [
        {
          label: "Payment created",
          active: true,
          note: new Date(latestPayment.created_at).toLocaleString(),
        },
        {
          label: "Webhook received",
          active: Number(latestPayment.verified) === 1,
          note: latestPayment.provider_reference || latestPayment.reference,
        },
        {
          label: "Order confirmed",
          active: ["paid", "captured", "in_escrow", "fulfilled"].includes(
            latestPayment.order_status || ""
          ),
          note: latestPayment.order_status || "pending_payment",
        },
        {
          label: "Funds held",
          active: ["initiated", "active", "released", "refunded", "disputed"].includes(
            latestPayment.escrow_state || ""
          ),
          note: latestPayment.escrow_state || "pending",
        },
        {
          label: "Final state",
          active: ["fulfilled", "released", "refunded"].includes(
            latestPayment.escrow_state || latestPayment.order_status || ""
          ),
          note: latestPayment.escrow_state || latestPayment.order_status || "pending",
        },
      ]
    : [];

  const paymentTone = (status: string): "zinc" | "emerald" | "amber" | "rose" | "blue" => {
    if (status === "captured" || status === "paid") return "emerald";
    if (status === "pending") return "amber";
    if (status === "failed" || status === "cancelled") return "rose";
    return "zinc";
  };

  const orderTone = (status: string | null): "zinc" | "emerald" | "amber" | "rose" | "blue" => {
    if (!status) return "zinc";
    if (status === "fulfilled") return "emerald";
    if (status === "refunded") return "rose";
    if (status === "paid" || status === "in_escrow" || status === "pending_payment") return "blue";
    if (status === "disputed") return "amber";
    return "zinc";
  };

  const escrowTone = (status: string | null): "zinc" | "emerald" | "amber" | "rose" | "blue" => {
    if (!status) return "zinc";
    if (status === "released") return "emerald";
    if (status === "refunded") return "rose";
    if (status === "disputed") return "amber";
    if (status === "initiated" || status === "funded" || status === "held") return "blue";
    return "zinc";
  };

  const formatDate = (value?: string | null): string => {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  };

  const normalizeStatusLabel = (value: string | null | undefined): string => {
  if (!value) return "—";
  const label = value.replace(/_/g, " ");
  return label.replace(/\bescrow\b/gi, "settlement");
};

  const sortedPayments = useMemo(() => sortPayments(payments, paymentSortMode), [payments, paymentSortMode]);
  const sortedWebhookEvents = useMemo(
    () => sortWebhooks(webhookEvents, webhookSortMode),
    [webhookEvents, webhookSortMode]
  );

  const activeSortLabel = activeTab === "payments"
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

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <button
            type="button"
            onClick={() => navigateToAdmin()}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold hover:bg-zinc-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Admin
          </button>

          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 space-y-8">
        <section className="flex flex-col gap-5 px-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-zinc-400">
              Admin
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-zinc-900 sm:text-4xl">
              Payments & Webhooks
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-medium leading-relaxed text-zinc-600 sm:text-base">
              Admin monitoring only. Buyer order status belongs elsewhere.
            </p>
          </div>

          <div className="flex overflow-hidden rounded-2xl border border-zinc-200">
            <button
              type="button"
              onClick={() => setActiveTab("payments")}
              className={`px-5 py-3 text-left ${
                activeTab === "payments"
                  ? "bg-zinc-700 text-white"
                  : "bg-zinc-100 text-zinc-500"
              }`}
            >
              Payments
              <br />
              <span className="text-lg font-black">{stats.totalPayments}</span>
            </button>
            <div className="w-px bg-zinc-200" />
            <button
              type="button"
              onClick={() => setActiveTab("webhooks")}
              className={`px-5 py-3 text-left ${
                activeTab === "webhooks"
                  ? "bg-zinc-700 text-white"
                  : "bg-zinc-100 text-zinc-500"
              }`}
            >
              Webhooks
              <br />
              <span className="text-lg font-black">{stats.totalWebhooks}</span>
            </button>
          </div>
        </section>

        {latestPayment ? (
          <section className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              <h2 className="text-lg font-black">Transaction lifecycle</h2>
            </div>
            <p className="mt-2 text-sm text-zinc-600">
              Showing the latest payment reference: {latestPayment.reference}
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {lifecycle.map((step) => (
                <LifecycleNode
                  key={step.label}
                  label={step.label}
                  active={step.active}
                  note={step.note}
                />
              ))}
            </div>
          </section>
        ) : null}
       <AdminPayoutQueue />
        
        <section className="space-y-3">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-500">
              Click to Sort
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              Current sort: <span className="font-bold text-zinc-900">{activeSortLabel}</span>
            </p>
          </div>

          {activeTab === "payments" ? (
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[2rem] border border-zinc-200 bg-zinc-200 p-px shadow-sm md:grid-cols-4">
              {[
                {
                  key: "recent" as const,
                  label: "Recent",
                  value: stats.totalPayments,
                  tone: "zinc" as const,
                },
                {
                  key: "verified" as const,
                  label: "Verified",
                  value: stats.verifiedPayments,
                  tone: "emerald" as const,
                },
                {
                  key: "paid" as const,
                  label: "Paid",
                  value: stats.paidPayments,
                  tone: "blue" as const,
                },
                {
                  key: "pending" as const,
                  label: "Pending",
                  value: stats.pendingPayments,
                  tone: "amber" as const,
                },
              ].map((item) => {
                const active = paymentSortMode === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setPaymentSortMode(item.key)}
                    className={`flex aspect-square flex-col justify-between p-4 text-left transition-colors md:p-5 ${
                      active ? "bg-zinc-950 text-white" : "bg-white text-zinc-900 hover:bg-zinc-50"
                    }`}
                    aria-pressed={active}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className={`text-xs font-black uppercase tracking-[0.18em] ${
                          active ? "text-zinc-300" : "text-zinc-400"
                        }`}
                      >
                        {item.label}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                          active ? "bg-white/10 text-white" : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        Sort
                      </span>
                    </div>
                    <div className="flex flex-1 items-end">
                      <p className="text-4xl font-black leading-none tracking-tight md:text-5xl">
                        {item.value}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[2rem] border border-zinc-200 bg-zinc-200 p-px shadow-sm md:grid-cols-3">
              {[
                {
                  key: "recent" as const,
                  label: "Recent",
                  value: stats.totalWebhooks,
                  tone: "zinc" as const,
                },
                {
                  key: "valid" as const,
                  label: "Valid hooks",
                  value: stats.validWebhooks,
                  tone: "emerald" as const,
                },
                {
                  key: "invalid" as const,
                  label: "Invalid hooks",
                  value: stats.invalidWebhooks,
                  tone: "rose" as const,
                },
              ].map((item) => {
                const active = webhookSortMode === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setWebhookSortMode(item.key)}
                    className={`flex aspect-square flex-col justify-between p-4 text-left transition-colors md:p-5 ${
                      active ? "bg-zinc-950 text-white" : "bg-white text-zinc-900 hover:bg-zinc-50"
                    }`}
                    aria-pressed={active}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className={`text-xs font-black uppercase tracking-[0.18em] ${
                          active ? "text-zinc-300" : "text-zinc-400"
                        }`}
                      >
                        {item.label}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                          active ? "bg-white/10 text-white" : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        Sort
                      </span>
                    </div>
                    <div className="flex flex-1 items-end">
                      <p className="text-4xl font-black leading-none tracking-tight md:text-5xl">
                        {item.value}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {activeTab === "payments" ? (
          <section className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                <h2 className="text-lg font-black">Payment records</h2>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
              </div>
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
                      <th className="p-4 text-left">Settlement</th>
                      <th className="p-4 text-left">Amount</th>
                      <th className="p-4 text-left">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPayments.map((payment) => (
                      <tr
                        key={payment.id}
                        className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50"
                      >
                        <td className="p-4">
                          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            BuyMesho reference
                          </p>
                          <p className="mt-1 break-all font-mono text-xs">{payment.reference}</p>
                          <p className="mt-2 text-[11px] text-zinc-400">{payment.provider}</p>
                        </td>
                        <td className="p-4">
                          <StatusPill
                            label={payment.payment_status}
                            tone={paymentTone(payment.payment_status)}
                          />
                          <div className="mt-2 text-xs text-zinc-500">{payment.method}</div>
                          <div className="mt-1 text-[11px] text-zinc-400">
                            Verified: {Number(payment.verified) === 1 ? "yes" : "no"}
                          </div>
                        </td>
                        <td className="p-4">
                          <StatusPill
                            label={normalizeStatusLabel(payment.order_status)}
                            tone={orderTone(payment.order_status)}
                          />
                          <div className="mt-2 break-all text-xs text-zinc-500">{payment.order_id}</div>
                          <div className="mt-1 text-[11px] text-zinc-400">
                            Order paid: {formatDate(payment.order_paid_at)}
                          </div>
                        </td>
                        <td className="p-4">
                          <StatusPill
                            label={normalizeStatusLabel(payment.escrow_state)}
                            tone={escrowTone(payment.escrow_state)}
                          />
                          <div className="mt-2 text-xs text-zinc-500">
                            {payment.escrow_id || "No settlement yet"}
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-400">
                            Settlement updated: {formatDate(payment.escrow_updated_at)}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="font-bold">
                            {payment.currency} {payment.amount}
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-400">
                            Gateway reference: {payment.provider_reference || "—"}
                          </div>
                        </td>
                        <td className="p-4 text-xs text-zinc-500">
                          {formatDate(payment.updated_at)}
                        </td>
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
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
              </div>
            ) : sortedWebhookEvents.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                No webhook events captured yet.
              </div>
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
                        <td className="p-4 align-top">{event.event_type || "—"}</td>
                        <td className="p-4 align-top break-all font-mono text-xs">
                          {event.reference || "—"}
                        </td>
                        <td className="p-4 align-top">
                          {Number(event.signature_valid) === 1 ? (
                            <StatusPill label="Valid" tone="emerald" />
                          ) : (
                            <StatusPill label="Invalid" tone="rose" />
                          )}
                        </td>
                        <td className="p-4 align-top text-zinc-500">
                          {formatDate(event.created_at)}
                        </td>
                        <td className="p-4 align-top">
                          {event.payload ? (
                            <details className="group">
                              <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-bold text-zinc-700">
                                <BadgeInfo className="h-3.5 w-3.5" />
                                View payload
                              </summary>
                              <pre className="mt-3 max-h-72 overflow-auto rounded-2xl bg-zinc-950 p-4 text-[11px] leading-relaxed text-zinc-100">
                                {event.payload}
                              </pre>
                            </details>
                          ) : (
                            "—"
                          )}
                        </td>
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
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-black text-zinc-900">How to read this page</p>
              <p className="text-sm leading-relaxed text-zinc-600">
                Pending means the payment has been created, but the webhook or verification step has
                not completed yet. Once confirmed, the order should move through paid and into
                the holding phase, and later to released or refunded. This page is the admin view only.
              </p>
              <p className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                <CircleAlert className="h-3.5 w-3.5" />
                Settlement control should stay in the order flow, not the admin page.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
