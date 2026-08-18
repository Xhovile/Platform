import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, TriangleAlert, Clock3, CircleCheckBig } from "lucide-react";
import { apiFetch } from "./lib/api";
import { useAuthUser } from "./hooks/useAuthUser";
import { useIsAdmin } from "./hooks/useIsAdmin";
import { getSellerPayoutStatusLabel, getVisibleAdminActions } from "./modules/payouts/uiModel";

type PayoutRow = {
  id: string;
  sellerId: string;
  orderId: string | null;
  escrowId: string | null;
  releaseEntryId: string | null;
  amount: number;
  currency: string;
  status: string;
  provider: string | null;
  providerChargeId: string | null;
  providerReference: string | null;
  providerTransactionId?: string | null;
  providerStatus: string | null;
  destinationAccountId: string | null;
  destinationMaskedAccount: string | null;
  destinationType: string | null;
  destinationVerificationStatus: string | null;
  sellerSuspended?: boolean;
  verificationBlockers?: string[];
  failureReason: string | null;
  manualReviewReason: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
  retryCount: number | null;
  latestAttemptNo: number | null;
  latestAttemptStatus: string | null;
  latestAttemptAt: string | null;
  latestAttemptFailureReason?: string | null;
  latestWebhookEventType?: string | null;
  latestWebhookEventAt?: string | null;
  attemptCount?: number;
  currentState?: string;
  lastError?: string | null;
  holdReason?: string | null;
  retryEligible?: boolean;
  retryBlockedReason?: string | null;
  auditSummary?: {
    totalEvents?: number;
    latestEventType?: string | null;
    latestEventAt?: string | null;
  };
};

type PayoutSummary = {
  summary?: {
    totalPayouts?: number;
    pendingPayouts?: number;
    paidPayouts?: number;
    failedPayouts?: number;
    cancelledPayouts?: number;
  };
  attempts?: {
    totalAttempts?: number;
    successfulAttempts?: number;
    failedAttempts?: number;
  };
};

function tone(status: string) {
  const s = status.toLowerCase();
  if (["paid"].includes(s)) return "emerald";
  if (["failed", "cancelled"].includes(s)) return "rose";
  if (["pending", "queued", "processing", "eligible", "held"].includes(s)) return "amber";
  return "zinc";
}

function pillClass(t: string) {
  switch (t) {
    case "emerald":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "rose":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "amber":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-zinc-100 text-zinc-700 border-zinc-200";
  }
}

function specialBadges(row: PayoutRow) {
  const badges: Array<{ label: string; className: string }> = [];
  if (["provider_unavailable", "provider_timeout", "provider_rate_limited"].includes((row.failureReason ?? "").toLowerCase())) {
    badges.push({ label: "provider outage", className: "border-amber-200 bg-amber-50 text-amber-700" });
  }
  if (row.status === "held") {
    badges.push({ label: "manual review", className: "border-sky-200 bg-sky-50 text-sky-700" });
  }
  if (row.status === "held" && (row.failureReason ?? "").startsWith("provider_")) {
    badges.push({ label: "retry blocked", className: "border-rose-200 bg-rose-50 text-rose-700" });
  }
  if (row.latestWebhookEventType === "payout_webhook_duplicate") {
    badges.push({ label: "duplicate webhook ignored", className: "border-zinc-200 bg-white text-zinc-700" });
  }
  if (row.latestWebhookEventType === "payout_reconciled") {
    badges.push({ label: "reconciled from provider callback", className: "border-emerald-200 bg-emerald-50 text-emerald-700" });
  }
  return badges;
}

export default function AdminPayoutQueue() {
  const { user } = useAuthUser();
  const { isAdmin } = useIsAdmin(user);
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [summary, setSummary] = useState<PayoutSummary>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    setRefreshing(true);
    try {
      const [payoutsData, summaryData] = await Promise.all([
        apiFetch("/api/admin/payouts"),
        apiFetch("/api/admin/payouts/summary"),
      ]);

      setRows(Array.isArray(payoutsData) ? payoutsData : []);
      setSummary((summaryData ?? {}) as PayoutSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payout queue.");
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
      total: summary.summary?.totalPayouts ?? rows.length,
      pending: summary.summary?.pendingPayouts ?? rows.filter((r) => ["eligible", "queued", "processing", "pending", "held"].includes(r.status)).length,
      paid: summary.summary?.paidPayouts ?? rows.filter((r) => r.status === "paid").length,
      failed: summary.summary?.failedPayouts ?? rows.filter((r) => r.status === "failed").length,
      attempts: summary.attempts?.totalAttempts ?? 0,
    }),
    [rows, summary]
  );

  const runAction = async (row: PayoutRow, action: "retry" | "hold" | "mark_paid" | "mark_failed", payload?: Record<string, unknown>) => {
    setActionBusyId(row.id);
    setError(null);
    try {
      if (action === "retry") {
        await apiFetch(`/api/payouts/${encodeURIComponent(row.sellerId)}/retry`, {
          method: "POST",
          body: JSON.stringify({
            payoutId: row.id,
            ...(payload ?? {}),
          }),
        });
      } else {
        await apiFetch(`/api/payouts/${encodeURIComponent(row.sellerId)}/override`, {
          method: "POST",
          body: JSON.stringify({
            payoutId: row.id,
            action,
            ...(payload ?? {}),
          }),
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <section className="rounded-[2rem] border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Admin payout queue</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight">Seller payout control</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Review payout states, retry failed transfers, or mark items paid/held after manual review.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh queue
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Stat label="Total payouts" value={stats.total} />
        <Stat label="Pending" value={stats.pending} />
        <Stat label="Paid" value={stats.paid} />
        <Stat label="Failed" value={stats.failed} />
      </div>

      <div className="mt-3 text-sm text-zinc-500">
        Provider attempts tracked: <span className="font-bold text-zinc-900">{stats.attempts}</span>
      </div>

      {error ? (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <TriangleAlert className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading payout queue...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-6 text-sm text-zinc-600">
            No payouts found yet.
          </div>
        ) : (
          rows.map((row) => {
            const busy = actionBusyId === row.id;
            const rowTone = tone(row.status);
            const badges = specialBadges(row);
            return (
              <div key={row.id} className="rounded-[1.75rem] border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${pillClass(rowTone)}`}>
                        {getSellerPayoutStatusLabel(row.status)}
                      </span>
                      {row.provider ? (
                        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-bold text-zinc-700">
                          {row.provider}
                        </span>
                      ) : null}
                      {row.destinationVerificationStatus ? (
                        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-bold text-zinc-700">
                          destination {row.destinationVerificationStatus}
                        </span>
                      ) : null}
                      {badges.map((badge) => (
                        <span key={badge.label} className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${badge.className}`}>
                          {badge.label}
                        </span>
                      ))}
                    </div>

                    <div className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-2 xl:grid-cols-3">
                      <Info label="Payout ID" value={row.id} />
                      <Info label="Seller ID" value={row.sellerId} />
                      <Info label="Order ID" value={row.orderId ?? "—"} />
                      <Info label="Escrow ID" value={row.escrowId ?? "—"} />
                      <Info label="Amount" value={`${row.currency} ${Number(row.amount).toLocaleString()}`} />
                      <Info label="Provider charge" value={row.providerChargeId ?? "—"} />
                      <Info label="Destination" value={row.destinationMaskedAccount ?? "—"} />
                      <Info label="Retry count" value={String(row.retryCount ?? 0)} />
                      <Info label="Last retry outcome" value={row.latestAttemptNo ? `#${row.latestAttemptNo} (${row.latestAttemptStatus ?? "—"})` : "—"} />
                      <Info label="Time of last retry" value={row.latestAttemptAt ? new Date(row.latestAttemptAt).toLocaleString() : "—"} />
                      <Info label="Requested" value={row.requestedAt ? new Date(row.requestedAt).toLocaleString() : "—"} />
                    </div>

                    {(row.latestAttemptFailureReason ?? row.failureReason) ? (
                      <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        <strong>Last error:</strong> {row.latestAttemptFailureReason ?? row.failureReason}
                      </p>
                    ) : null}

                    {row.manualReviewReason ? (
                      <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        <strong>Review:</strong> {row.manualReviewReason}
                      </p>
                    ) : null}
                    <div className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
                      <Info label="Attempts used" value={String(row.attemptCount ?? row.latestAttemptNo ?? 0)} />
                      <Info label="Retry eligibility" value={row.retryEligible ? "Can retry safely" : row.retryBlockedReason ?? "Retry unavailable"} />
                      <Info label="Last provider response" value={row.lastError ?? "No provider error captured"} />
                      <Info label="Audit trail" value={row.auditSummary?.latestEventType ? `${row.auditSummary.latestEventType} (${row.auditSummary.totalEvents ?? 0})` : "No audit events"} />
                    </div>
                  </div>

                  {getVisibleAdminActions(isAdmin).length > 0 ? (
                    <div className="flex flex-wrap gap-2 lg:w-[320px] lg:justify-end">
                      <ActionButton
                        icon={<RefreshCw className="h-4 w-4" />}
                        label="Retry"
                        busy={busy}
                        onClick={() => runAction(row, "retry", { destinationReference: row.destinationMaskedAccount ?? row.id })}
                      />
                      <ActionButton
                        icon={<CircleCheckBig className="h-4 w-4" />}
                        label="Mark paid"
                        busy={busy}
                        onClick={() => {
                          const reason = window.prompt("Reason for marking paid");
                          if (!reason?.trim()) return;
                          void runAction(row, "mark_paid", { reason: reason.trim() });
                        }}
                      />
                      <ActionButton
                        icon={<ShieldCheck className="h-4 w-4" />}
                        label="Hold"
                        busy={busy}
                        onClick={() => {
                          const reason = window.prompt("Reason for hold");
                          if (!reason?.trim()) return;
                          void runAction(row, "hold", { reason: reason.trim() });
                        }}
                      />
                      <ActionButton
                        icon={<TriangleAlert className="h-4 w-4" />}
                        label="Mark failed"
                        busy={busy}
                        danger
                        onClick={() => {
                          const reason = window.prompt("Reason for marking failed");
                          if (!reason?.trim()) return;
                          void runAction(row, "mark_failed", { reason: reason.trim() });
                        }}
                      />
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-500">
                      Admin actions hidden
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-zinc-900">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">{label}</p>
      <p className="mt-1 break-all font-medium text-zinc-900">{value}</p>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  busy,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold disabled:opacity-60 ${
        danger ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-zinc-900 text-white hover:bg-zinc-800"
      }`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}
