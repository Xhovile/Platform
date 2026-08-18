import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BadgeInfo, CircleAlert,SquareArrowOutUpRight, CreditCard, Loader2, Search, ShieldCheck, Wallet, Webhook } from "lucide-react";
import { apiFetch } from "./lib/api";
import AdminWorkspaceLayout from "./modules/admin/AdminWorkspaceLayout";
import type { PayoutAdjustment, PayoutRow } from "./AdminPayoutsManager";
import {
  getSellerPayoutStatusDetail,
  getSellerPayoutStatusLabel,
  sellerOperationalSignals,
} from "./modules/payouts/uiModel";
import type { PayoutRecord } from "./modules/payouts/types";
import { money, payoutFeeNote, payoutMathBreakdown } from "./pages/seller-payouts/sellerPayouts.helpers";
import SellerPayoutsHistorySection from "./pages/seller-payouts/components/SellerPayoutsHistorySection";

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

type Tone = "zinc" | "emerald" | "amber" | "rose" | "blue";
type LifecycleState = "done" | "active" | "waiting" | "issue";
type LifecycleStep = { number: number; title: string; detail: string; state: LifecycleState; timestamp?: string; dbRecord?: string; externalRef?: string; error?: string | null };
type Diagnostic = { title: string; detail: string; tone: Tone };

type PayoutSortMode = "recent" | "paid" | "failed" | "held";

const TONE_CLASSES: Record<Tone, string> = {
  zinc: "bg-zinc-100 text-zinc-700 border-zinc-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
};

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
  if (["captured", "paid", "success"].includes(s)) return "emerald";
  if (s === "pending") return "amber";
  if (["failed", "cancelled", "error"].includes(s)) return "rose";
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

function SummaryCard({ label, value, detail, tone = "zinc" }: { label: string; value: string | number; detail?: string; tone?: Tone }) {
  return (
    <div className="rounded-[1.75rem] border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-4">
        <p className="text-3xl font-black tracking-tight text-zinc-950">{value}</p>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${TONE_CLASSES[tone]}`}>{label}</span>
      </div>
      {detail ? <p className="mt-2 text-sm text-zinc-600">{detail}</p> : null}
    </div>
  );
}

function DiagnosticCard({ diagnostic }: { diagnostic: Diagnostic }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${diagnostic.tone === "emerald" ? "border-emerald-200 bg-emerald-50/70" : diagnostic.tone === "amber" ? "border-amber-200 bg-amber-50/70" : diagnostic.tone === "rose" ? "border-rose-200 bg-rose-50/70" : diagnostic.tone === "blue" ? "border-blue-200 bg-blue-50/70" : "border-zinc-200 bg-white"}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 font-black text-zinc-900 shadow-sm">
          {diagnostic.tone === "emerald" ? "✓" : diagnostic.tone === "rose" ? "!" : diagnostic.tone === "amber" ? "?" : "i"}
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-black tracking-tight text-zinc-900">{diagnostic.title}</h4>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">{diagnostic.detail}</p>
        </div>
      </div>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const formatted = useMemo(() => {
    if (typeof value === "string") {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value || "—";
      }
    }
    return JSON.stringify(value ?? null, null, 2);
  }, [value]);

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950 p-4 text-zinc-100 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-400">{title}</p>
      <pre className="mt-3 max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{formatted}</pre>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="break-all font-semibold text-zinc-900">{value}</span>
    </div>
  );
}

function PayoutTableRow({
  payout,
  onSelect,
}: {
  payout: PayoutRow;
  onSelect: (payout: PayoutRow) => void;
}) {
  const payoutMath = payoutMathBreakdown({
    ...payout,
    grossAmount: payout.grossAmount ?? undefined,
    platformFeeAmount: payout.platformFeeAmount ?? undefined,
    reserveAmount: payout.reserveAmount ?? undefined,
    payoutFeeAmount: payout.legacyProcessingFeeAmount ?? undefined,
    sellerReceivesAmount: payout.netAmount ?? payout.amount,
  } as PayoutRecord);

  const signals = sellerOperationalSignals({
    status: payout.status,
    destinationStatus: payout.destinationStatus,
    retryAllowed: payout.retryAllowed,
    manualReviewPending: payout.manualReviewPending,
    verificationBlockers: payout.verificationBlockers,
  });

  return (
    <tr className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50" onClick={() => onSelect(payout)}>
      <td className="p-4 align-top">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">Payout</p>
        <p className="mt-1 break-all font-mono text-xs">{payout.id}</p>
        <p className="mt-2 text-[11px] text-zinc-400">Seller {payout.sellerId}</p>
      </td>
      <td className="p-4 align-top">
        <StatusPill label={getSellerPayoutStatusLabel(payout.status)} tone={token(payout.status) === "paid" ? "emerald" : token(payout.status) === "failed" ? "rose" : token(payout.status) === "held" ? "amber" : "zinc"} />
        <div className="mt-2 text-xs text-zinc-500">{getSellerPayoutStatusDetail(payout.status)}</div>
        <div className="mt-2 space-y-1">
          {signals.slice(0, 3).map((message) => (
            <div key={`${payout.id}-${message}`} className="rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
              {message}
            </div>
          ))}
        </div>
      </td>
      <td className="p-4 align-top text-zinc-600">
        <div className="font-bold text-zinc-900">{money(Number(payoutMath.sellerReceivesAmount), payoutMath.currency)}</div>
        <div className="mt-2 space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[11px] font-semibold text-zinc-500">
          <div className="flex justify-between gap-3">
            <span>Gross</span>
            <span>{money(Number(payoutMath.grossAmount), payoutMath.currency)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Fees</span>
            <span>-{money(Number(payoutMath.platformFeeAmount) + Number(payoutMath.payChanguFeeAmount), payoutMath.currency)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Total you receive</span>
            <span>{money(Number(payoutMath.sellerReceivesAmount), payoutMath.currency)}</span>
          </div>
          <div className="rounded-lg bg-white px-2 py-1 text-[10px] leading-4 text-zinc-600">{payoutFeeNote({ ...payout, grossAmount: payout.grossAmount ?? undefined, platformFeeAmount: payout.platformFeeAmount ?? undefined, reserveAmount: payout.reserveAmount ?? undefined, payoutFeeAmount: payout.legacyProcessingFeeAmount ?? undefined, sellerReceivesAmount: payout.netAmount ?? payout.amount } as PayoutRecord)}</div>
        </div>
      </td>
      <td className="p-4 align-top text-zinc-600">{payout.orderId || payout.escrowId || "—"}</td>
      <td className="p-4 align-top text-zinc-500">{formatDate(payout.updatedAt)}</td>
    </tr>
  );
}

function buildLifecycleSteps(payment?: PaymentRow | null, webhook?: WebhookEventRow | null, payout?: PayoutRow | null): LifecycleStep[] {
  const hasPayment = !!payment;
  const hasCheckout = !!payment?.checkout_url;
  const hasWebhook = !!webhook;
  const hasValidWebhook = webhook ? Number(webhook.signature_valid) === 1 : false;
  const isPaid = !!payment && (["paid", "captured", "success"].includes(token(payment.payment_status)) || !!payment.paid_at);
  const isEscrowActive = !!payment && (["in_escrow", "paid"].includes(token(payment.order_status)) || !!payment.escrow_id);
  const isDelivered = !!payment && token(payment.order_status) === "fulfilled";
  const isSettled = !!payment && ["released", "refunded"].includes(token(payment.escrow_state));
  const isDisputed = !!payment && token(payment.escrow_state) === "disputed";
  const hasPayout = !!payout;
  const destinationVerified = !!payout && token(payout.destinationVerificationStatus) === "verified" && payout.destinationActive !== false;
  const payoutProcessing = !!payout && ["queued", "processing", "pending", "held"].includes(token(payout.status));
  const payoutComplete = !!payout && token(payout.status) === "paid";

  return [
    { number: 1, title: "Checkout created", detail: hasPayment ? "BuyMesho stored a payment row for this checkout attempt." : "No payment row exists yet.", state: hasPayment ? "done" : "waiting", timestamp: payment?.created_at, dbRecord: payment?.id, externalRef: payment?.reference },
    { number: 2, title: "Payment completed", detail: hasCheckout ? "The buyer was sent to the provider checkout URL." : "Waiting for checkout creation.", state: hasCheckout ? "done" : hasPayment ? "active" : "waiting", timestamp: payment?.paid_at, dbRecord: payment?.id, externalRef: payment?.provider_reference },
    { number: 3, title: "Webhook received", detail: hasWebhook ? "PayChangu callback delivery was captured." : "No webhook event has arrived yet.", state: hasWebhook ? "active" : "waiting", timestamp: webhook?.created_at, dbRecord: webhook?.id ? String(webhook.id) : undefined, externalRef: webhook?.reference },
    { number: 4, title: "Webhook verified", detail: hasValidWebhook ? "Webhook signature passed verification." : hasWebhook ? "Webhook arrived, but verification has not passed yet." : "Waiting for a webhook to verify.", state: hasValidWebhook ? "done" : hasWebhook ? "issue" : "waiting", timestamp: webhook?.created_at, dbRecord: webhook?.id ? String(webhook.id) : undefined, externalRef: webhook?.reference, error: hasWebhook && !hasValidWebhook ? "Invalid or missing signature" : null },
    { number: 5, title: "Order marked paid", detail: isPaid ? "The order was marked paid and moved into the confirmed flow." : "The order is still pending confirmation.", state: isPaid ? "done" : "waiting", timestamp: payment?.order_paid_at, dbRecord: payment?.order_id, externalRef: payment?.reference },
    { number: 6, title: "Escrow created", detail: isEscrowActive ? "Funds are represented as active escrow for the order." : "Escrow has not started yet.", state: isEscrowActive ? (isDisputed ? "issue" : "active") : "waiting", timestamp: payment?.escrow_updated_at, dbRecord: payment?.escrow_id ?? undefined, externalRef: payment?.order_id },
    { number: 7, title: "Delivery confirmed", detail: isDelivered ? "The order has been marked fulfilled after delivery confirmation." : "Waiting for delivery confirmation.", state: isDelivered ? "done" : "waiting", timestamp: payment?.order_fulfilled_at, dbRecord: payment?.order_id, externalRef: payment?.escrow_id ?? undefined },
    { number: 8, title: "Escrow released", detail: isSettled ? (token(payment?.escrow_state) === "released" ? "Funds were released to the seller." : "Funds were refunded to the buyer.") : "Final settlement has not happened yet.", state: token(payment?.escrow_state) === "released" ? "done" : token(payment?.escrow_state) === "refunded" ? "issue" : "waiting", timestamp: payment?.escrow_updated_at, dbRecord: payment?.escrow_id ?? undefined, externalRef: payment?.order_id },
    { number: 9, title: "Payout generated", detail: hasPayout ? "A seller payout record exists for this transaction." : "No seller payout row has been linked yet.", state: hasPayout ? "done" : "waiting", timestamp: payout?.createdAt, dbRecord: payout?.id, externalRef: payout?.providerReference },
    { number: 10, title: "Destination verified", detail: destinationVerified ? "The payout destination is verified and active." : hasPayout ? "Destination still needs verification or activation." : "No payout destination context yet.", state: destinationVerified ? "done" : hasPayout ? "issue" : "waiting", timestamp: payout?.updatedAt, dbRecord: payout?.destinationAccountId ?? undefined, externalRef: payout?.destinationMaskedAccount ?? undefined, error: hasPayout && !destinationVerified ? toText(payout?.destinationLastError, "Destination unverified") : null },
    { number: 11, title: "PayChangu transfer", detail: payoutComplete ? "The seller payout has completed successfully." : payoutProcessing ? "The payout is still moving through the settlement flow." : hasPayout ? "The payout is not finished yet." : "No seller payout to process.", state: payoutComplete ? "done" : payoutProcessing ? "active" : hasPayout ? "issue" : "waiting", timestamp: payout?.latestAttemptAt ?? payout?.sentAt ?? payout?.updatedAt, dbRecord: payout?.id, externalRef: payout?.providerTransactionId ?? payout?.providerReference, error: payout?.latestAttemptFailureReason ?? payout?.lastError },
    { number: 12, title: "Seller paid", detail: hasPayout && payoutComplete ? "The payout path is fully closed out." : hasPayout ? "The payout path is still open." : "The transaction has not closed the payout loop yet.", state: hasPayout && payoutComplete ? "done" : "waiting", timestamp: payout?.paidAt, dbRecord: payout?.id, externalRef: payout?.providerTransactionId ?? payout?.providerReference },
  ];
}

function buildDiagnostics(payment?: PaymentRow | null, webhook?: WebhookEventRow | null, payout?: PayoutRow | null): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (payment) {
    diagnostics.push({ title: "Payment row present", detail: `Reference ${payment.reference} loaded from Admin Payments.`, tone: "emerald" });
  } else {
    diagnostics.push({ title: "Missing payment row", detail: "No payment row was returned by the admin payments endpoint.", tone: "rose" });
  }

  if (payment?.provider_reference) {
    diagnostics.push({ title: "Gateway reference mapped", detail: payment.provider_reference, tone: "emerald" });
  } else if (payment) {
    diagnostics.push({ title: "Gateway reference missing", detail: "The provider reference was not returned or not persisted.", tone: "amber" });
  }

  if (payment && webhook) {
    const matches = webhook.reference === payment.reference;
    diagnostics.push({
      title: matches ? "Webhook correlation" : "Webhook mismatch",
      detail: matches ? "Latest webhook matches the selected payment reference." : `Latest webhook reference ${toText(webhook.reference)} does not match payment ${payment.reference}.`,
      tone: matches ? (Number(webhook.signature_valid) === 1 ? "emerald" : "amber") : "rose",
    });
  } else if (payment) {
    diagnostics.push({ title: "Webhook correlation missing", detail: "No webhook event matched the latest payment reference.", tone: "rose" });
  }

  if (payment && payout) {
    const paymentAmount = Number(payment.amount || 0);
    const payoutAmount = Number(payout.amount || 0);
    diagnostics.push({
      title: paymentAmount === payoutAmount ? "Amount reconciled" : "Amount mismatch",
      detail: paymentAmount === payoutAmount
        ? `${payment.currency} ${paymentAmount.toLocaleString()} matches the payout row.`
        : `Payment shows ${payment.currency} ${paymentAmount.toLocaleString()}, payout shows ${payout.currency} ${payoutAmount.toLocaleString()}.`,
      tone: paymentAmount === payoutAmount ? "emerald" : "rose",
    });
  }

  if (payout) {
    const destinationVerified = token(payout.destinationVerificationStatus) === "verified" && payout.destinationActive !== false;
    diagnostics.push({ title: "Payout row present", detail: `${payout.id} loaded from Admin Payouts.`, tone: "emerald" });
    diagnostics.push({
      title: "Destination state",
      detail: destinationVerified ? "Destination is verified and active." : `Destination status: ${toText(payout.destinationVerificationStatus)}${payout.destinationActive === false ? " (inactive)" : ""}.`,
      tone: destinationVerified ? "emerald" : "amber",
    });
    if (payout.providerReference || payout.providerTransactionId) {
      diagnostics.push({ title: "Provider linkage", detail: [payout.providerReference, payout.providerTransactionId].filter(Boolean).join(" · "), tone: "emerald" });
    } else {
      diagnostics.push({ title: "Provider linkage missing", detail: "No provider reference or provider transaction id is attached to this payout.", tone: "amber" });
    }
    if (payout.retryBlockedReason || payout.manualReviewReason || payout.holdReason || payout.latestAttemptFailureReason || payout.lastError) {
      diagnostics.push({ title: "Blocking reason present", detail: payout.retryBlockedReason || payout.manualReviewReason || payout.holdReason || payout.latestAttemptFailureReason || payout.lastError || "Pending manual review", tone: "amber" });
    }
  }

  return diagnostics;
}

function sortPayouts(rows: PayoutRow[], mode: PayoutSortMode) {
  return [...rows].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
    const rightTime = Date.parse(right.updatedAt || right.createdAt || "");
    const rank = (status: string) => {
      if (mode === "paid") return token(status) === "paid" ? 0 : 1;
      if (mode === "failed") return token(status) === "failed" ? 0 : 1;
      if (mode === "held") return token(status) === "held" ? 0 : 1;
      return 0;
    };
    const leftRank = rank(left.status);
    const rightRank = rank(right.status);
    if (leftRank !== rightRank) return leftRank - rightRank;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.id.localeCompare(right.id);
  });
}

export default function TransactionInspectorPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [sellerHistory, setSellerHistory] = useState<PayoutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPayoutId, setSelectedPayoutId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [selectedPayoutAdjustments, setSelectedPayoutAdjustments] = useState<PayoutAdjustment[]>([]);
  const [selectedPayoutAdjustmentsLoading, setSelectedPayoutAdjustmentsLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setError(null);
      setLoading(true);
      try {
        const [paymentsData, webhookData, payoutsData] = await Promise.allSettled([
          apiFetch("/api/admin/payments"),
          apiFetch("/api/admin/webhook-events"),
          apiFetch("/api/admin/payouts?limit=100&offset=0"),
        ]);

        if (!mounted) return;

        setPayments(paymentsData.status === "fulfilled" && Array.isArray(paymentsData.value) ? paymentsData.value : []);
        setWebhookEvents(webhookData.status === "fulfilled" && Array.isArray(webhookData.value) ? webhookData.value : []);
        setPayouts(
          payoutRowsFromResponse(payoutsData.status === "fulfilled" ? payoutsData.value : null),
        );
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load transaction inspector data.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const sortedPayments = useMemo(() => [...payments].sort((a, b) => Date.parse(b.updated_at || b.created_at || "") - Date.parse(a.updated_at || a.created_at || "")), [payments]);
  const sortedWebhooks = useMemo(() => [...webhookEvents].sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || "")), [webhookEvents]);
  const sortedPayouts = useMemo(() => sortPayouts(payouts, "recent"), [payouts]);

  const searchNeedle = token(submittedQuery);
  const hasSubmittedSearch = searchNeedle.length > 0;
  const paymentMatchesQuery = (payment: PaymentRow) => {
    const values = [
      payment.id,
      payment.order_id,
      payment.reference,
      payment.provider_reference,
      payment.escrow_id,
      payment.payment_status,
      payment.order_status,
      payment.escrow_state,
    ];
    return values.some((value) => token(value).includes(searchNeedle));
  };
  const webhookMatchesQuery = (event: WebhookEventRow) => [event.id, event.reference, event.event_type, event.payload].some((value) => token(value).includes(searchNeedle));
  const payoutMatchesQuery = (payout: PayoutRow) => [
    payout.id,
    payout.sellerId,
    payout.orderId,
    payout.escrowId,
    payout.providerReference,
    payout.providerTransactionId,
    payout.providerChargeId,
    payout.destinationAccountId,
    payout.destinationMaskedAccount,
  ].some((value) => token(value).includes(searchNeedle));

  const matchingPayments = useMemo(() => {
    if (!hasSubmittedSearch) return [];
    const matchedPayouts = sortedPayouts.filter(payoutMatchesQuery);
    const matchedWebhooks = sortedWebhooks.filter(webhookMatchesQuery);
    return sortedPayments.filter((payment) => (
      paymentMatchesQuery(payment) ||
      matchedPayouts.some((payout) => payout.orderId === payment.order_id || (payout.escrowId && payout.escrowId === payment.escrow_id)) ||
      matchedWebhooks.some((event) => event.reference && event.reference === payment.reference)
    ));
  }, [hasSubmittedSearch, searchNeedle, sortedPayments, sortedPayouts, sortedWebhooks]);

  const latestPayment = matchingPayments.find((payment) => payment.id === selectedPaymentId) ?? matchingPayments[0] ?? null;
  const latestWebhook = latestPayment
    ? sortedWebhooks.find((event) => event.reference && event.reference === latestPayment.reference) ?? sortedWebhooks.find(webhookMatchesQuery) ?? null
    : null;
  const linkedPayout = useMemo(() => {
    if (!latestPayment) return sortedPayouts.find(payoutMatchesQuery) ?? null;
    return (
      sortedPayouts.find((row) => row.orderId === latestPayment.order_id) ??
      sortedPayouts.find((row) => row.escrowId && latestPayment.escrow_id && row.escrowId === latestPayment.escrow_id) ??
      null
    );
  }, [latestPayment, searchNeedle, sortedPayouts]);

  const selectedPayout = useMemo(
    () => sortedPayouts.find((row) => row.id === selectedPayoutId) ?? linkedPayout ?? null,
    [linkedPayout, selectedPayoutId, sortedPayouts],
  );

const transactionJsonHref = `/transaction-json?q=${encodeURIComponent(
  submittedQuery.trim() ||
    latestPayment?.reference ||
    latestPayment?.order_id ||
    selectedPayout?.id ||
    ""
)}`;
  
  useEffect(() => {
    let mounted = true;

    if (!selectedPayout?.sellerId) {
      setSellerHistory([]);
      setSelectedPayoutAdjustments([]);
      return;
    }

    const loadSellerHistory = async () => {
      setSelectedPayoutAdjustmentsLoading(true);
      try {
        const [historyRes, adjustmentsRes] = await Promise.allSettled([
          apiFetch(`/api/payouts/history/${encodeURIComponent(selectedPayout.sellerId)}`),
          apiFetch(`/api/admin/payouts/${encodeURIComponent(selectedPayout.id)}/adjustments`),
        ]);

        if (!mounted) return;

        setSellerHistory(historyRowsFromResponse(historyRes.status === "fulfilled" ? historyRes.value : null));
        setSelectedPayoutAdjustments(
          adjustmentsRowsFromResponse(adjustmentsRes.status === "fulfilled" ? adjustmentsRes.value : null),
        );
      } catch {
        if (!mounted) return;
        setSellerHistory([]);
        setSelectedPayoutAdjustments([]);
      } finally {
        if (mounted) setSelectedPayoutAdjustmentsLoading(false);
      }
    };

    void loadSellerHistory();
    return () => {
      mounted = false;
    };
  }, [selectedPayout]);

  const lifecycleSteps = useMemo(
    () => buildLifecycleSteps(latestPayment, latestWebhook, selectedPayout),
    [latestPayment, latestWebhook, selectedPayout],
  );

  const diagnostics = useMemo(
    () => buildDiagnostics(latestPayment, latestWebhook, selectedPayout),
    [latestPayment, latestWebhook, selectedPayout],
  );

  const integrityHints = useMemo(() => {
    const hints: string[] = [];
    if (latestPayment && selectedPayout && latestPayment.order_id !== selectedPayout.orderId) {
      hints.push(`Order mismatch: payment ${latestPayment.order_id} vs payout ${toText(selectedPayout.orderId)}`);
    }
    if (latestPayment && selectedPayout && latestPayment.escrow_id && selectedPayout.escrowId && latestPayment.escrow_id !== selectedPayout.escrowId) {
      hints.push(`Escrow mismatch: payment ${latestPayment.escrow_id} vs payout ${toText(selectedPayout.escrowId)}`);
    }
    if (latestPayment && selectedPayout && Number(latestPayment.amount) !== Number(selectedPayout.amount)) {
      hints.push(`Amount mismatch: payment ${latestPayment.currency} ${Number(latestPayment.amount).toLocaleString()} vs payout ${selectedPayout.currency} ${Number(selectedPayout.amount).toLocaleString()}`);
    }
    if (selectedPayout && token(selectedPayout.destinationVerificationStatus) !== "verified") {
      hints.push("Payout destination still needs verification.");
    }
    if (selectedPayout && selectedPayout.destinationActive === false) {
      hints.push("Payout destination is disabled.");
    }
    return hints;
  }, [latestPayment, selectedPayout]);

  const historySummary = useMemo(() => {
    const total = sellerHistory.length;
    const paid = sellerHistory.filter((row) => token(row.status) === "paid").length;
    const held = sellerHistory.filter((row) => token(row.status) === "held").length;
    const failed = sellerHistory.filter((row) => token(row.status) === "failed").length;
    return { total, paid, held, failed };
  }, [sellerHistory]);

  const latestPaymentDiagnosis = latestPayment
    ? [
        { label: "Reference", value: latestPayment.reference },
        { label: "Gateway ref", value: latestPayment.provider_reference || "Not returned" },
        { label: "Payment status", value: normalizeStatusLabel(latestPayment.payment_status) },
        { label: "Order status", value: normalizeStatusLabel(latestPayment.order_status) },
        { label: "Escrow status", value: normalizeStatusLabel(latestPayment.escrow_state) },
        { label: "Amount", value: `${latestPayment.currency} ${Number(latestPayment.amount).toLocaleString()}` },
      ]
    : [];

  const latestWebhookDiagnosis = latestWebhook
    ? [
        { label: "Event", value: toText(latestWebhook.event_type) },
        { label: "Reference", value: toText(latestWebhook.reference) },
        { label: "Signature", value: Number(latestWebhook.signature_valid) === 1 ? "Valid" : "Invalid" },
        { label: "Received", value: formatDate(latestWebhook.created_at) },
      ]
    : [];

  const payoutSortLabel = "Recent";
  const matchedPayoutRows = hasSubmittedSearch ? sortedPayouts.filter((payout) => payoutMatchesQuery(payout) || (latestPayment ? payout.orderId === latestPayment.order_id || (payout.escrowId && payout.escrowId === latestPayment.escrow_id) : false)) : [];
  const payoutRowsForReview = matchedPayoutRows.length ? matchedPayoutRows : (selectedPayout ? [selectedPayout] : []);
  const unmatchedPayouts = matchedPayoutRows.filter((payout) => !matchingPayments.some((payment) => payment.order_id === payout.orderId || (payment.escrow_id && payment.escrow_id === payout.escrowId)));

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedQuery(searchInput.trim());
    setSelectedPaymentId(null);
    setSelectedPayoutId(null);
  };

  return (
    <AdminWorkspaceLayout
      title="Transaction Inspector"
      description="A separate admin page for the transaction flow, payout resolution, and seller payout history."
      onRefresh={() => window.location.reload()}
    >
      <main className="space-y-8">
        <section className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-zinc-400">One source of truth</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-zinc-950">Inspect one transaction from checkout to seller paid.</h1>
              <p className="mt-3 text-sm leading-6 text-zinc-600">Paste an Order ID, Escrow ID, Buyer Email, Seller ID, payment reference, PayChangu reference, provider transaction ID, payout ID, listing/event ID, or webhook reference. Results appear only after search, then select a transaction to open the investigation record.</p>
            </div>
            <form onSubmit={handleSearchSubmit} className="flex w-full flex-col gap-3 sm:flex-row lg:max-w-2xl">
              <label className="sr-only" htmlFor="transaction-inspector-search">Search transaction identifiers</label>
              <input
                id="transaction-inspector-search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Order, escrow, buyer email, seller, payout, webhook, PayChangu ref…"
                className="min-h-12 flex-1 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white"
              />
              <button type="submit" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-5 text-sm font-black text-white shadow-sm transition hover:bg-zinc-800">
                <Search className="h-4 w-4" /> Submit
              </button>
              <a
                href={transactionJsonHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-black text-zinc-950 transition hover:bg-zinc-100"
                >
                <SquareArrowOutUpRight className="h-4 w-4" />
                View JSON
              </a>
            </form>
          </div>
          {hasSubmittedSearch ? <p className="mt-4 text-sm font-semibold text-zinc-600">Search results for <span className="text-zinc-950">{submittedQuery}</span>: {matchingPayments.length} linked payment transaction(s){unmatchedPayouts.length ? ` · ${unmatchedPayouts.length} payout-only match(es)` : ""}</p> : null}
        </section>

        {!hasSubmittedSearch ? (
          <section className="rounded-[2rem] border border-dashed border-zinc-300 bg-zinc-50 p-10 text-center">
            <p className="text-lg font-black text-zinc-950">Start with search.</p>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-zinc-600">The primary view stays intentionally simple. Search any transaction-related identifier to load matching records, then choose a transaction to see payment, webhook, order, escrow, payout, seller history, reconciliation, and debugging details.</p>
          </section>
        ) : null}

        {hasSubmittedSearch && matchingPayments.length > 1 ? (
          <section className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-zinc-950">Select a transaction</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {matchingPayments.map((payment) => (
                <button key={payment.id} type="button" onClick={() => setSelectedPaymentId(payment.id)} className={`rounded-2xl border p-4 text-left transition hover:border-zinc-400 ${latestPayment?.id === payment.id ? "border-zinc-950 bg-zinc-50" : "border-zinc-200 bg-white"}`}>
                  <p className="break-all font-mono text-xs font-black text-zinc-950">{payment.reference}</p>
                  <p className="mt-2 text-sm text-zinc-600">Order {payment.order_id}</p>
                  <p className="mt-1 text-sm text-zinc-600">{payment.currency} {Number(payment.amount).toLocaleString()} · {normalizeStatusLabel(payment.payment_status)}</p>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {hasSubmittedSearch && !latestPayment && !selectedPayout ? (
          <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">No transaction records matched that identifier. Try a payment reference, PayChangu reference, order ID, escrow ID, payout ID, buyer email, seller ID, listing/event ID, or webhook reference.</section>
        ) : null}

        {hasSubmittedSearch && (latestPayment || selectedPayout) ? <>
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
                      <div className="mt-3 space-y-1 text-[11px] font-semibold text-zinc-500">
                        <p>Timestamp: <span className="text-zinc-800">{formatDate(step.timestamp)}</span></p>
                        <p>Database record: <span className="break-all text-zinc-800">{toText(step.dbRecord)}</span></p>
                        <p>External reference: <span className="break-all text-zinc-800">{toText(step.externalRef)}</span></p>
                        {step.error ? <p className="text-rose-700">Error: {step.error}</p> : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
          <div className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700"><ShieldCheck className="h-5 w-5" /></div>
              <div className="space-y-2">
                <p className="text-sm font-black text-zinc-900">Transaction integrity</p>
                <p className="text-sm leading-relaxed text-zinc-600">These checks surface payment capture, webhook verification, payout routing, destination verification, and seller history problems before you jump between pages.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {diagnostics.map((diagnostic) => (
                <DiagnosticCard key={`${diagnostic.title}-${diagnostic.detail}`} diagnostic={diagnostic} />
              ))}
            </div>

            {integrityHints.length ? (
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p className="font-black text-amber-950">Mismatch hints</p>
                <ul className="mt-2 space-y-1">
                  {integrityHints.map((hint) => (
                    <li key={hint}>• {hint}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              <h3 className="text-base font-black">Payout snapshot</h3>
            </div>

            {selectedPayout ? (
              <div className="mt-4 space-y-3">
                <Row label="Payout ID" value={selectedPayout.id} />
                <Row label="Seller ID" value={selectedPayout.sellerId} />
                <Row label="Status" value={<StatusPill label={getSellerPayoutStatusLabel(selectedPayout.status)} tone={token(selectedPayout.status) === "paid" ? "emerald" : token(selectedPayout.status) === "failed" ? "rose" : token(selectedPayout.status) === "held" ? "amber" : "zinc"} />} />
                <Row label="Destination" value={selectedPayout.destinationMaskedAccount || "—"} />
                <Row label="Destination type" value={toText(selectedPayout.destinationType)} />
                <Row label="Requested at" value={formatDate(selectedPayout.requestedAt)} />
                <Row label="Updated at" value={formatDate(selectedPayout.updatedAt)} />
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                  <p className="font-black text-zinc-950">Quick read</p>
                  <p className="mt-2">{getSellerPayoutStatusDetail(selectedPayout.status)}</p>
                  <div className="mt-3 space-y-1">
                    {sellerOperationalSignals({
                      status: selectedPayout.status,
                      destinationStatus: selectedPayout.destinationStatus,
                      retryAllowed: selectedPayout.retryAllowed,
                      manualReviewPending: selectedPayout.manualReviewPending,
                      verificationBlockers: selectedPayout.verificationBlockers,
                    }).map((message) => (
                      <div key={message} className="rounded-xl border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold">{message}</div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-500">No payout row selected yet.</p>
            )}

            <div className="mt-5 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
              <p className="font-black text-zinc-950">Seller history summary</p>
              <p className="mt-2">Total: {historySummary.total} · Paid: {historySummary.paid} · Held: {historySummary.held} · Failed: {historySummary.failed}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              <h3 className="text-base font-black">Latest payment</h3>
            </div>
            {latestPayment ? (
              <div className="mt-4 grid gap-2">
                {latestPaymentDiagnosis.map((item) => <Row key={item.label} label={item.label} value={item.value} />)}
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-500">No payment row loaded.</p>
            )}
          </div>

          <div className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              <h3 className="text-base font-black">Latest webhook</h3>
            </div>
            {latestWebhook ? (
              <div className="mt-4 grid gap-2">
                {latestWebhookDiagnosis.map((item) => <Row key={item.label} label={item.label} value={item.value} />)}
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-500">No webhook event loaded.</p>
            )}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-black">Order & escrow record</h3>
            {latestPayment ? (
              <div className="mt-4 grid gap-2">
                <Row label="Order ID" value={latestPayment.order_id} />
                <Row label="Order status" value={<StatusPill label={normalizeStatusLabel(latestPayment.order_status)} tone={orderTone(latestPayment.order_status)} />} />
                <Row label="Buyer paid at" value={formatDate(latestPayment.order_paid_at)} />
                <Row label="Fulfilled at" value={formatDate(latestPayment.order_fulfilled_at)} />
                <Row label="Escrow ID" value={toText(latestPayment.escrow_id)} />
                <Row label="Escrow state" value={<StatusPill label={normalizeStatusLabel(latestPayment.escrow_state)} tone={escrowTone(latestPayment.escrow_state)} />} />
                <Row label="Escrow amount" value={latestPayment.balance_amount === null ? "—" : `${latestPayment.balance_currency || latestPayment.currency} ${Number(latestPayment.balance_amount).toLocaleString()}`} />
              </div>
            ) : <p className="mt-4 text-sm text-zinc-500">No order or escrow record correlated to this search.</p>}
          </div>

          <div className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-black">Payout attempts & overrides</h3>
            {selectedPayout ? (
              <div className="mt-4 grid gap-2">
                <Row label="Attempt count" value={selectedPayout.attemptCount ?? selectedPayout.latestAttemptNo ?? "—"} />
                <Row label="Latest attempt" value={toText(selectedPayout.latestAttemptStatus)} />
                <Row label="Latest attempt at" value={formatDate(selectedPayout.latestAttemptAt)} />
                <Row label="Retry allowed" value={selectedPayout.retryAllowed === false ? "No" : "Yes / not blocked"} />
                <Row label="Manual review" value={selectedPayout.manualReviewPending ? "Pending" : "Not pending"} />
                <Row label="Adjustments" value={selectedPayoutAdjustmentsLoading ? "Loading…" : selectedPayoutAdjustments.length} />
              </div>
            ) : <p className="mt-4 text-sm text-zinc-500">No payout record correlated to this search.</p>}
          </div>

          <div className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-black">Provider & destination</h3>
            {selectedPayout ? (
              <div className="mt-4 grid gap-2">
                <Row label="Provider" value={toText(selectedPayout.provider)} />
                <Row label="Provider ref" value={toText(selectedPayout.providerReference)} />
                <Row label="Transaction ID" value={toText(selectedPayout.providerTransactionId)} />
                <Row label="Destination status" value={toText(selectedPayout.destinationVerificationStatus)} />
                <Row label="Destination active" value={selectedPayout.destinationActive === false ? "No" : "Yes / unknown"} />
                <Row label="Last error" value={toText(selectedPayout.lastError || selectedPayout.destinationLastError || selectedPayout.latestAttemptFailureReason)} />
              </div>
            ) : <p className="mt-4 text-sm text-zinc-500">No destination record correlated to this search.</p>}
          </div>
        </section>

        <section className="min-w-0 max-w-full overflow-hidden rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-black">Developer debugging</h3>
          <p className="mt-2 text-sm text-zinc-600">Raw records exposed for webhook payload inspection, parsed payload comparison, payment/escrow/payout database state, retry logs, API response fields, processing errors, and validation results.</p>
          <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-2">
            <JsonBlock title="Raw webhook payload" value={latestWebhook?.payload ?? null} />
            <JsonBlock title="Parsed webhook payload" value={latestWebhook?.payload ? (() => { try { return JSON.parse(latestWebhook.payload); } catch { return { parseError: "Payload is not valid JSON", raw: latestWebhook.payload }; } })() : null} />
            <JsonBlock title="Database payment / order / escrow record" value={latestPayment} />
            <JsonBlock title="Payout / destination / retry record" value={selectedPayout} />
            <JsonBlock title="Adjustment history" value={selectedPayoutAdjustments} />
            <JsonBlock title="Seller payout history" value={sellerHistory} />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-500">Payouts</p>
              <p className="mt-1 text-sm text-zinc-600">Current sort: <span className="font-bold text-zinc-900">{payoutSortLabel}</span></p>
            </div>
            <div className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-bold text-zinc-600">Read-only review</div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm">
            {loading ? (
              <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" /></div>
            ) : payoutRowsForReview.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">No payout rows found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-zinc-500">
                    <tr>
                      <th className="p-4 text-left">Payout</th>
                      <th className="p-4 text-left">Status</th>
                      <th className="p-4 text-left">Amount</th>
                      <th className="p-4 text-left">Order</th>
                      <th className="p-4 text-left">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutRowsForReview.map((payout) => (
                      <PayoutTableRow key={payout.id} payout={payout} onSelect={(next) => setSelectedPayoutId(next.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section>
          <SellerPayoutsHistorySection payouts={sellerHistory} canViewHistory={true} />
        </section>

        <section className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700"><BadgeInfo className="h-5 w-5" /></div>
            <div className="space-y-2">
              <p className="text-sm font-black text-zinc-900">How to read this page</p>
              <p className="text-sm leading-relaxed text-zinc-600">This page is the deep-dive layer. The main admin payments console stays separate; this page focuses on payout state, reconciliation signals, and seller payout history.</p>
              <p className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700"><CircleAlert className="h-3.5 w-3.5" />Escrow control belongs in the order flow, not here.</p>
            </div>
          </div>
        </section>
        </> : null}
      </main>
    </AdminWorkspaceLayout>
  );
}

function payoutRowsFromResponse(response: unknown): PayoutRow[] {
  if (Array.isArray(response)) return response as PayoutRow[];
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  return Array.isArray(record.rows) ? (record.rows as PayoutRow[]) : Array.isArray(record.payouts) ? (record.payouts as PayoutRow[]) : [];
}

function historyRowsFromResponse(response: unknown): PayoutRecord[] {
  if (Array.isArray(response)) return response as PayoutRecord[];
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  return Array.isArray(record.payouts) ? (record.payouts as PayoutRecord[]) : Array.isArray(record.rows) ? (record.rows as PayoutRecord[]) : [];
}

function adjustmentsRowsFromResponse(response: unknown): PayoutAdjustment[] {
  if (Array.isArray(response)) return response as PayoutAdjustment[];
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  return Array.isArray(record.adjustments) ? (record.adjustments as PayoutAdjustment[]) : Array.isArray(record.rows) ? (record.rows as PayoutAdjustment[]) : [];
}
