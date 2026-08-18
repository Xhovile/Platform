import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
  Wallet,
} from "lucide-react";
import ActionModal from "./components/ActionModal";
import AdminWorkspaceLayout from "./modules/admin/AdminWorkspaceLayout";
import { apiFetch } from "./lib/api";
import { navigateToAdminPayouts } from "./lib/appNavigation";

type DestinationRequestRow = {
  id: string;
  sellerId: string;
  orderId: string | null;
  amount: number;
  currency: string;
  status: string;
  destinationAccountId: string | null;
  destinationMaskedAccount: string | null;
  destinationType: string | null;
  destinationVerificationStatus: string | null;
  destinationActive?: boolean;
  destinationLastError?: string | null;
  sellerSuspended?: boolean;
  verificationBlockers?: string[];
  createdAt: string;
  updatedAt: string;
};

type PayoutsListResponse = {
  rows?: DestinationRequestRow[];
  pagination?: {
    limit?: number;
    offset?: number;
    total?: number;
    hasMore?: boolean;
  };
};

type DecisionState =
  | { row: DestinationRequestRow; action: "approve" }
  | { row: DestinationRequestRow; action: "reject" }
  | null;

function formatMoney(amount: number, currency: string) {
  const safeAmount = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${currency || "MWK"} ${safeAmount.toLocaleString()}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function badgeClass(label: string) {
  const normalized = label.toLowerCase();
  if (normalized === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "pending") return "border-amber-200 bg-amber-50 text-amber-700";
  if (normalized === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (normalized === "disabled") return "border-zinc-200 bg-zinc-100 text-zinc-700";
  return "border-zinc-200 bg-white text-zinc-700";
}

function normalizeDestinationRow(row: DestinationRequestRow): DestinationRequestRow {
  const destinationVerificationStatus =
    row.destinationVerificationStatus ??
    (row.destinationActive === false ? "disabled" : "pending");

  return {
    ...row,
    destinationVerificationStatus,
    destinationActive:
      row.destinationActive ?? destinationVerificationStatus === "verified",
    destinationLastError: row.destinationLastError ?? null,
    sellerSuspended: row.sellerSuspended ?? false,
    verificationBlockers: Array.isArray(row.verificationBlockers) ? row.verificationBlockers : [],
  };
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{value}</p>
    </div>
  );
}

export default function AdminPayoutDestinationRequestsPage() {
  const [rows, setRows] = useState<DestinationRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const [decision, setDecision] = useState<DecisionState>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);

  const load = async () => {
    setError(null);
    setRefreshing(true);
    try {
      const data = (await apiFetch("/api/admin/payout-destination-requests?limit=200&offset=0")) as PayoutsListResponse | DestinationRequestRow[];
      const fetchedRows = Array.isArray(data)
        ? data
        : Array.isArray(data?.rows)
          ? data.rows
          : [];

      setRows(fetchedRows.map(normalizeDestinationRow));
      setLastRefreshAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load destination requests.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const reviewRows = useMemo(() => {
    return rows.filter((row) => {
      const status = String(row.destinationVerificationStatus ?? "").toLowerCase();
      const needsReview =
        !!row.destinationAccountId &&
        (status !== "verified" || row.destinationActive === false || row.sellerSuspended === true);

      if (!needsReview) return false;

      const q = query.trim().toLowerCase();
      if (!q) return true;

      return (
        row.id.toLowerCase().includes(q) ||
        String(row.sellerId ?? "").toLowerCase().includes(q) ||
        String(row.orderId ?? "").toLowerCase().includes(q) ||
        String(row.destinationAccountId ?? "").toLowerCase().includes(q) ||
        String(row.destinationMaskedAccount ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query]);

  const stats = useMemo(() => {
    const pending = reviewRows.filter((row) => String(row.destinationVerificationStatus ?? "").toLowerCase() === "pending").length;
    const failed = reviewRows.filter((row) => String(row.destinationVerificationStatus ?? "").toLowerCase() === "failed").length;
    const disabled = reviewRows.filter((row) => String(row.destinationVerificationStatus ?? "").toLowerCase() === "disabled" || row.destinationActive === false).length;
    const suspended = reviewRows.filter((row) => row.sellerSuspended === true).length;

    return {
      total: reviewRows.length,
      pending,
      failed,
      disabled,
      suspended,
    };
  }, [reviewRows]);

  const openDecision = (row: DestinationRequestRow, action: "approve" | "reject") => {
    setDecision({ row, action });
    setDecisionReason("");
  };

  const submitDecision = async () => {
    if (!decision?.row.destinationAccountId) return;

    if (decision.action === "reject" && !decisionReason.trim()) {
      setError("Reason is required when rejecting a destination.");
      return;
    }

    setDecisionBusy(true);
    setError(null);

    try {
      await apiFetch(
        `/api/admin/payouts/destinations/${encodeURIComponent(decision.row.destinationAccountId)}/verification`,
        {
          method: "POST",
          body: JSON.stringify({
            status: decision.action === "approve" ? "verified" : "failed",
            reason: decision.action === "reject" ? decisionReason.trim() : undefined,
          }),
        }
      );

      setDecision(null);
      setDecisionReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update destination verification.");
    } finally {
      setDecisionBusy(false);
    }
  };

  const title = "Seller Payout Destination Requests";
  const description = "Review, approve, or reject seller payout destinations without cluttering the main payouts queue.";

  return (
    <AdminWorkspaceLayout title={title} description={description} onRefresh={load}>
      <div className="space-y-6">
        <section className="rounded-[2rem] border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                Admin queue
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-zinc-900">
                Destination review queue
              </h2>
              <p className="mt-2 text-sm text-zinc-500">
                Approve verified destinations, reject bad ones, and keep payout release control visible.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigateToAdminPayouts()}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
              >
                <Wallet className="h-4 w-4" />
                Back to Payouts
              </button>
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <CircleAlert className="h-4 w-4" />
            {error}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-5">
          <StatCard label="Requests" value={stats.total} />
          <StatCard label="Pending" value={stats.pending} />
          <StatCard label="Failed" value={stats.failed} />
          <StatCard label="Disabled" value={stats.disabled} />
          <StatCard label="Suspended sellers" value={stats.suspended} />
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by payout ID, seller ID, order ID, or destination account"
                className="w-full rounded-2xl border border-zinc-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none ring-zinc-300 focus:ring"
              />
            </div>

            <div className="flex items-center justify-end text-xs font-semibold text-zinc-500">
              Last refresh: <span className="ml-1 font-bold text-zinc-900">{formatDate(lastRefreshAt)}</span>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-5 text-sm text-zinc-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading destination requests...
          </div>
        ) : reviewRows.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-8 text-sm text-zinc-600">
            No destination requests need attention right now.
          </div>
        ) : (
          <section className="space-y-3">
            {reviewRows.map((row) => {
              const status = String(row.destinationVerificationStatus ?? "pending").toLowerCase();
              const active = row.destinationActive !== false;
              const suspended = row.sellerSuspended === true;

              return (
                <div key={row.id} className="rounded-[1.75rem] border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${badgeClass(status)}`}>
                          {status}
                        </span>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-zinc-100 text-zinc-700"}`}>
                          {active ? "active" : "inactive"}
                        </span>
                        {suspended ? (
                          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">
                            seller suspended
                          </span>
                        ) : null}
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Seller</p>
                          <p className="mt-1 text-sm font-bold text-zinc-900">{row.sellerId}</p>
                        </div>
                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Destination</p>
                          <p className="mt-1 text-sm font-bold text-zinc-900">
                            {row.destinationType || "—"} · {row.destinationMaskedAccount || row.destinationAccountId || "—"}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Amount</p>
                          <p className="mt-1 text-sm font-bold text-zinc-900">{formatMoney(row.amount, row.currency)}</p>
                        </div>
                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Updated</p>
                          <p className="mt-1 text-sm font-bold text-zinc-900">{formatDate(row.updatedAt)}</p>
                        </div>
                      </div>

                      {row.verificationBlockers?.length ? (
                        <div className="flex flex-wrap gap-2">
                          {row.verificationBlockers.map((blocker) => (
                            <span
                              key={blocker}
                              className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700"
                            >
                              {blocker}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {row.destinationLastError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {row.destinationLastError}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => openDecision(row, "approve")}
                        className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => openDecision(row, "reject")}
                        className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-100"
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>

      <ActionModal
        open={!!decision}
        title={
          decision?.action === "approve"
            ? "Approve destination"
            : "Reject destination"
        }
        message={
          decision?.row.destinationMaskedAccount
            ? `Destination ${decision.row.destinationMaskedAccount} for seller ${decision.row.sellerId}.`
            : decision
              ? `Destination request for seller ${decision.row.sellerId}.`
              : undefined
        }
        confirmLabel={decision?.action === "approve" ? "Approve" : "Reject"}
        danger={decision?.action === "reject"}
        loading={decisionBusy}
        inputLabel={decision?.action === "reject" ? "Reason for rejection" : undefined}
        inputValue={decision?.action === "reject" ? decisionReason : undefined}
        inputPlaceholder={decision?.action === "reject" ? "Explain why this destination is being rejected" : undefined}
        inputType={decision?.action === "reject" ? "textarea" : "text"}
        onInputChange={(value) => setDecisionReason(value)}
        onConfirm={() => void submitDecision()}
        onCancel={() => {
          setDecision(null);
          setDecisionReason("");
        }}
      />
    </AdminWorkspaceLayout>
  );
}
