import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { apiFetch } from "./lib/api";
import { useAuthUser } from "./hooks/useAuthUser";
import { useIsAdmin } from "./hooks/useIsAdmin";
import { getSellerPayoutStatusLabel, getVisibleAdminActions } from "./modules/payouts/uiModel";
import ActionModal from "./components/ActionModal";
import AdminWorkspaceLayout from "./modules/admin/AdminWorkspaceLayout";
import { navigateToAdminPayoutDestinations } from "./lib/appNavigation";
import FormDropdown from "./components/FormDropdown";
import PayoutQueueCard from "./PayoutQueueCard";
import PayoutDetailDrawer from "./AdminPayoutDetailDrawer";

export type PayoutDiagnostics = Record<string, unknown>;

export type PayoutRow = {
  id: string;
  sellerId: string;
  orderId: string | null;
  escrowId: string | null;
  escrowState?: string | null;
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
  destinationStatus?: string | null;
  destinationActive?: boolean;
  destinationLastError?: string | null;
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
  retryAllowed?: boolean;
  manualReviewPending?: boolean;
  retryBlockedReason?: string | null;
  auditSummary?: {
    totalEvents?: number;
    latestEventType?: string | null;
    latestEventAt?: string | null;
  };
  grossAmount?: number;
  platformFeeAmount?: number;
  legacyProcessingFeeAmount?: number;
  reserveAmount?: number;
  reserveCapAmount?: number;
  manualAdjustmentAmount?: number;
  netAmount?: number;
  diagnostics?: PayoutDiagnostics;
  latestAttemptProviderChargeId?: string | null;
  latestAttemptProviderReference?: string | null;
  latestAttemptProviderTransactionId?: string | null;
  latestAttemptProviderResponse?: unknown;
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

export type PayoutAdjustment = {
  id: string;
  payoutId: string;
  sellerId: string;
  adjustmentType: "processing_fee" | "manual_adjustment";
  amount: number;
  currency: string;
  reason: string;
  actorType: string;
  actorId: string | null;
  providerReference: string | null;
  createdAt: string;
};

type Notice = {
  type: "success" | "error";
  message: string;
};

export type OverrideAction = "hold" | "mark_paid" | "mark_failed" | "cancel";
export type RowAction = "retry" | OverrideAction;

type StatusFilter = "all" | "pending" | "failed" | "held" | "paid" | "cancelled";

const PENDING_STATES = ["eligible", "queued", "processing", "pending", "held"];
const PAGE_SIZE = 50;
const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending states" },
  { value: "failed", label: "Failed" },
  { value: "held", label: "Held" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
] as const;
const DESTINATION_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "verified", label: "Verified" },
  { value: "failed", label: "Failed" },
  { value: "disabled", label: "Disabled" },
] as const;
const ADJUSTMENT_TYPE_OPTIONS = [
  { value: "manual_adjustment", label: "Manual payout adjustment" },
  { value: "processing_fee", label: "Legacy compatibility amount (hidden)" },
] as const;

type PayoutsListResponse = {
  rows?: PayoutRow[];
  pagination?: {
    limit?: number;
    offset?: number;
    total?: number;
    hasMore?: boolean;
  };
};

type PendingDialog =
  | {
      kind: "retry";
      row: PayoutRow;
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
    }
  | {
      kind: "reconcile";
      row: PayoutRow;
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
    }
  | {
      kind: "refund_escrow";
      row: PayoutRow;
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
    }
  | {
      kind: "override";
      row: PayoutRow;
      action: OverrideAction;
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
    };

function toDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusTone(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["failed", "cancelled"].includes(normalized)) return "border-rose-200 bg-rose-50 text-rose-700";
  if (PENDING_STATES.includes(normalized)) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-zinc-200 bg-zinc-100 text-zinc-700";
}

function formatStatus(value: string | null | undefined) {
  if (!value) return "—";
  const normalized = String(value || "").toLowerCase();
  if (
    ["eligible", "queued", "processing", "pending", "held", "paid", "failed", "cancelled"].includes(
      normalized,
    )
  ) {
    return getSellerPayoutStatusLabel(normalized);
  }
  return value.replace(/_/g, " ");
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

function canRefundEscrow(row: PayoutRow, isAdmin: boolean) {
  const escrowState = String(row.escrowState ?? "").toLowerCase();
  return (
    isAdmin &&
    Boolean(row.orderId) &&
    Boolean(row.escrowId) &&
    escrowState !== "released" &&
    escrowState !== "refunded" &&
    escrowState !== "closed"
  );
}

function canAction(row: PayoutRow, action: RowAction) {
  const status = String(row.status || "").toLowerCase();
  const hasProviderAttemptSignal =
    Number(row.attemptCount ?? 0) > 0 ||
    Number(row.latestAttemptNo ?? 0) > 0 ||
    Boolean(row.providerTransactionId) ||
    Boolean(row.providerReference);

  if (action === "retry") {
    return row.retryEligible === true;
  }

  if (action === "hold") {
    return !["paid", "cancelled", "held"].includes(status);
  }

  if (action === "mark_paid") {
    return status === "held" && hasProviderAttemptSignal;
  }

  if (action === "mark_failed") {
    return !["paid", "cancelled", "failed"].includes(status);
  }

  if (action === "cancel") {
    return !["paid", "cancelled"].includes(status);
  }

  return false;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-zinc-900">{value}</p>
    </div>
  );
}

function normalizePayoutRow(row: PayoutRow): PayoutRow {
  const destinationVerificationStatus = row.destinationVerificationStatus ?? row.destinationStatus ?? null;
  const destinationLastError =
    row.destinationLastError ??
    row.lastError ??
    row.latestAttemptFailureReason ??
    row.failureReason ??
    null;

  const retryEligible = row.retryEligible ?? row.retryAllowed ?? false;

  return {
    ...row,
    destinationVerificationStatus,
    destinationStatus: row.destinationStatus ?? destinationVerificationStatus,
    destinationActive:
      row.destinationActive ?? (destinationVerificationStatus ? destinationVerificationStatus === "verified" : undefined),
    destinationLastError,
    latestAttemptFailureReason: row.latestAttemptFailureReason ?? destinationLastError,
    retryEligible,
    retryAllowed: row.retryAllowed ?? retryEligible,
    manualReviewPending:
      row.manualReviewPending ??
      Boolean(row.holdReason || row.manualReviewReason || destinationLastError),
  };
}

export default function AdminPayoutsManager() {
  const { user } = useAuthUser();
  const { isAdmin } = useIsAdmin(user);

  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [summary, setSummary] = useState<PayoutSummary>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [batchReconciling, setBatchReconciling] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [retryEligibleOnly, setRetryEligibleOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [hasMoreRows, setHasMoreRows] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<PayoutAdjustment[]>([]);
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false);

  const [destinationStatus, setDestinationStatus] = useState("verified");
  const [destinationReason, setDestinationReason] = useState("");
  const [sellerControlReason, setSellerControlReason] = useState("");

  const [adjustmentType, setAdjustmentType] = useState<"processing_fee" | "manual_adjustment">("manual_adjustment");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentProviderRef, setAdjustmentProviderRef] = useState("");
  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [refundReason, setRefundReason] = useState("");

  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const closeActionDialog = () => {
    setPendingDialog(null);
    setOverrideReason("");
    setRefundReason("");
  };


  const reloadSelected = async () => {
    await load(pageIndex);
    if (selectedId) {
      await loadAdjustments(selectedId);
    }
  };

  const handleUpdateDestinationVerification = async () => {
    if (!selected) return;
    if (!selected.destinationAccountId) {
      setNotice({ type: "error", message: "This payout has no destination account." });
      return;
    }

    const status = destinationStatus.trim().toLowerCase();
    if (!["pending", "verified", "failed", "disabled"].includes(status)) {
      setNotice({ type: "error", message: "Choose a valid destination status first." });
      return;
    }

    if ((status === "failed" || status === "disabled") && !destinationReason.trim()) {
      setNotice({ type: "error", message: "Destination reason is required for failed or disabled status." });
      return;
    }

    setActionBusyId(selected.id);
    try {
      await apiFetch(`/api/admin/payouts/destinations/${encodeURIComponent(selected.destinationAccountId)}/verification`, {
        method: "POST",
        body: JSON.stringify({
          status,
          reason: destinationReason.trim() || undefined,
        }),
      });
      setNotice({ type: "success", message: "Destination verification updated." });
      await reloadSelected();
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to update destination verification." });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleApproveDestinationVerification = async () => {
    if (!selected) return;
    if (!selected.destinationAccountId) {
      setNotice({ type: "error", message: "This payout has no destination account." });
      return;
    }

    setActionBusyId(selected.id);
    try {
      await apiFetch(`/api/admin/payouts/destinations/${encodeURIComponent(selected.destinationAccountId)}/verification`, {
        method: "POST",
        body: JSON.stringify({
          status: "verified",
          reason: destinationReason.trim() || "Approved by admin",
        }),
      });
      setNotice({ type: "success", message: "Destination approved as verified." });
      await reloadSelected();
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to approve destination verification." });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleUpdateSellerSuspension = async (suspended: boolean) => {
    if (!selected) return;
    const reason = sellerControlReason.trim();
    if (!reason) {
      setNotice({ type: "error", message: "Seller suspension reason is required." });
      return;
    }

    setActionBusyId(selected.id);
    try {
      await apiFetch(`/api/admin/payouts/sellers/${encodeURIComponent(selected.sellerId)}/suspension`, {
        method: "POST",
        body: JSON.stringify({
          suspended,
          reason,
        }),
      });
      setNotice({
        type: "success",
        message: suspended ? "Seller payouts suspended." : "Seller payouts restored.",
      });
      await reloadSelected();
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to update seller suspension." });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleCreateAdjustment = async () => {
    if (!selected) return;

    const amount = Number(adjustmentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice({ type: "error", message: "Enter a valid adjustment amount." });
      return;
    }
    const reason = adjustmentReason.trim();
    if (!reason) {
      setNotice({ type: "error", message: "Adjustment reason is required." });
      return;
    }

    setActionBusyId(selected.id);
    try {
      await apiFetch(`/api/admin/payouts/${encodeURIComponent(selected.id)}/adjustments`, {
        method: "POST",
        body: JSON.stringify({
          adjustmentType,
          amount,
          reason,
          providerReference: adjustmentProviderRef.trim() || undefined,
        }),
      });
      setNotice({ type: "success", message: "Adjustment saved." });
      setAdjustmentAmount("");
      setAdjustmentReason("");
      setAdjustmentProviderRef("");
      await reloadSelected();
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to save adjustment." });
    } finally {
      setActionBusyId(null);
    }
  };

  const load = async (nextPageIndex = pageIndex) => {
    setError(null);
    setRefreshing(true);
    try {
      const [payoutsData, summaryData] = await Promise.all([
        apiFetch(`/api/admin/payouts?limit=${PAGE_SIZE}&offset=${nextPageIndex * PAGE_SIZE}`),
        apiFetch("/api/admin/payouts/summary"),
      ]);
      const payouts = payoutsData as PayoutsListResponse;
      const nextRows = Array.isArray(payouts.rows) ? payouts.rows.map(normalizePayoutRow) : [];
      const nextTotal = Number(payouts.pagination?.total ?? nextRows.length);
      const nextHasMore = Boolean(payouts.pagination?.hasMore);
      setRows(nextRows);
      setTotalRows(nextTotal);
      setHasMoreRows(nextHasMore);
      setPageIndex(nextPageIndex);
      setSummary((summaryData ?? {}) as PayoutSummary);
      setLastRefreshAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payouts.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadAdjustments = async (payoutId: string) => {
    setAdjustmentsLoading(true);
    try {
      const data = (await apiFetch(`/api/admin/payouts/${encodeURIComponent(payoutId)}/adjustments`)) as {
        adjustments?: PayoutAdjustment[];
      };
      setAdjustments(Array.isArray(data.adjustments) ? data.adjustments : []);
    } catch {
      setAdjustments([]);
    } finally {
      setAdjustmentsLoading(false);
    }
  };

  useEffect(() => {
    void load(0);
  }, []);

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === "pending" && !PENDING_STATES.includes(String(row.status).toLowerCase())) {
        return false;
      }
      if (statusFilter !== "all" && statusFilter !== "pending" && String(row.status).toLowerCase() !== statusFilter) {
        return false;
      }
      if (retryEligibleOnly && row.retryEligible !== true) {
        return false;
      }
      if (!term) {
        return true;
      }
      const haystack = [
        row.id,
        row.sellerId,
        row.orderId,
        row.escrowId,
        row.releaseEntryId,
        row.provider,
        row.providerChargeId,
        row.providerReference,
        row.destinationMaskedAccount,
        row.destinationType,
        row.destinationVerificationStatus,
        row.destinationStatus,
        row.failureReason,
        row.manualReviewReason,
        row.retryBlockedReason,
        row.latestAttemptFailureReason,
        row.holdReason,
        row.lastError,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [query, retryEligibleOnly, rows, statusFilter]);

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  const visibleActions = useMemo(() => getVisibleAdminActions(isAdmin), [isAdmin]);

  useEffect(() => {
    if (!selected) {
      setAdjustments([]);
      return;
    }
    void loadAdjustments(selected.id);
  
    setDestinationStatus(selected.destinationVerificationStatus ?? selected.destinationStatus ?? "verified");
    setDestinationReason(selected.destinationLastError ?? selected.lastError ?? selected.latestAttemptFailureReason ?? "");
    setSellerControlReason("");
    setAdjustmentAmount("");
    setAdjustmentReason("");
    setAdjustmentProviderRef(selected.providerReference ?? "");
    setAdjustmentType("manual_adjustment");
  }, [selected]);

  const handleExportCsv = () => {
    const header = [
      "id",
      "sellerId",
      "status",
      "providerStatus",
      "amount",
      "currency",
      "orderId",
      "escrowId",
      "providerChargeId",
      "providerReference",
      "providerTransactionId",
      "failureReason",
      "manualReviewReason",
      "requestedBy",
      "requestedAt",
      "sentAt",
      "paidAt",
      "failedAt",
    ];

    const rowsCsv = [header.map(csvCell).join(",")]
      .concat(
        filteredRows.map((row) =>
          [
            row.id,
            row.sellerId,
            row.status,
            row.providerStatus,
            row.amount,
            row.currency,
            row.orderId,
            row.escrowId,
            row.providerChargeId,
            row.providerReference,
            row.providerTransactionId,
            row.failureReason,
            row.manualReviewReason,
            row.requestedBy,
            row.requestedAt,
            row.sentAt,
            row.paidAt,
            row.failedAt,
          ]
            .map(csvCell)
            .join(","),
        ),
      )
      .join("\n");

    const blob = new Blob([rowsCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `payouts-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleRefresh = async () => {
    await load(pageIndex);
  };


  const handleRetry = async (row: PayoutRow) => {
    setActionBusyId(row.id);
    try {
      await apiFetch(`/api/payouts/${encodeURIComponent(row.sellerId)}/retry`, {
        method: "POST",
        body: JSON.stringify({
          payoutId: row.id,
        }),
      });
      setNotice({ type: "success", message: "Payout retried." });
      await load(pageIndex);
      if (selectedId) {
        await loadAdjustments(selectedId);
      }
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Retry failed." });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleOpenDialog = (row: PayoutRow, kind: PendingDialog["kind"], action?: OverrideAction) => {
    if (kind === "retry") {
      setPendingDialog({
        kind,
        row,
        title: "Retry payout",
        message: "Create a new attempt for this payout.",
        confirmLabel: "Retry payout",
      });
      return;
    }

    if (kind === "reconcile") {
      setPendingDialog({
        kind,
        row,
        title: "Reconcile payout",
        message: "Re-check the payout against provider status.",
        confirmLabel: "Reconcile now",
      });
      return;
    }

    if (kind === "refund_escrow") {
      setNotice({ type: "error", message: "Refund escrow is not wired in this build." });
      return;
    }

    if (kind === "override" && action) {
      setPendingDialog({
        kind,
        row,
        action,
        title:
          action === "hold"
            ? "Hold payout"
            : action === "mark_paid"
              ? "Mark payout paid"
              : action === "mark_failed"
                ? "Mark payout failed"
                : "Cancel payout",
        message: "This changes the payout state directly.",
        confirmLabel:
          action === "hold"
            ? "Hold payout"
            : action === "mark_paid"
              ? "Mark paid"
              : action === "mark_failed"
                ? "Mark failed"
                : "Cancel payout",
        danger: action !== "mark_paid",
      });
    }
  };

  const handleConfirmDialog = async () => {
    if (!pendingDialog) return;
    setActionBusyId(pendingDialog.row.id);
    try {
      if (pendingDialog.kind === "retry") {
        await apiFetch(`/api/payouts/${encodeURIComponent(pendingDialog.row.sellerId)}/retry`, {
          method: "POST",
          body: JSON.stringify({
            payoutId: pendingDialog.row.id,
          }),
        });
      } else if (pendingDialog.kind === "reconcile") {
        await apiFetch(`/api/admin/payouts/${encodeURIComponent(pendingDialog.row.id)}/reconcile`, { method: "POST" });
      } else if (pendingDialog.kind === "override") {
        await apiFetch(`/api/payouts/${encodeURIComponent(pendingDialog.row.sellerId)}/override`, {
          method: "POST",
          body: JSON.stringify({
            payoutId: pendingDialog.row.id,
            action: pendingDialog.action,
            reason: overrideReason,
          }),
        });
      }
      closeActionDialog();
      await load(pageIndex);
      if (selectedId) {
        await loadAdjustments(selectedId);
      }
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Action failed." });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleBulkReconcile = async () => {
    setBatchReconciling(true);
    try {
      await apiFetch("/api/admin/payouts/reconcile", { method: "POST" });
      setNotice({ type: "success", message: "Reconciliation started." });
      await load(pageIndex);
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Reconciliation failed." });
    } finally {
      setBatchReconciling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <AdminWorkspaceLayout title="Payout queue" description="Manage payout lifecycle, review exact failure reasons, and reconcile provider state.">
      <div className="space-y-6">
        <div className="rounded-[2rem] border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Admin payouts</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-zinc-950">Payout queue</h1>
              <p className="mt-1 text-sm text-zinc-500">
                Manage payout lifecycle, review exact failure reasons, and reconcile provider state.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <button
                type="button"
                onClick={handleBulkReconcile}
                disabled={batchReconciling}
                className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {batchReconciling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
                Reconcile batch
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          </div>
        </div>

        {notice ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
              notice.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {notice.message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-4">
          <Stat label="Total payouts" value={summary.summary?.totalPayouts ?? 0} />
          <Stat label="Pending" value={summary.summary?.pendingPayouts ?? 0} />
          <Stat label="Paid" value={summary.summary?.paidPayouts ?? 0} />
          <Stat label="Failed" value={summary.summary?.failedPayouts ?? 0} />
        </div>

        <div className="flex flex-wrap gap-3 rounded-[2rem] border border-zinc-200 bg-white p-4 shadow-sm">
          <FormDropdown
            label="Status filter"
            value={statusFilter}
            options={STATUS_FILTER_OPTIONS}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            placeholder="Filter by status"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search payout, seller, order, provider..."
            className="min-w-[260px] flex-1 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition focus:border-zinc-400"
          />
          <label className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-600">
            <input
              type="checkbox"
              checked={retryEligibleOnly}
              onChange={(event) => setRetryEligibleOnly(event.target.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            Retry eligible only
          </label>
        </div>

        <div className="rounded-[2rem] border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-extrabold uppercase tracking-[0.16em] text-[11px]">Status</th>
                  <th className="px-4 py-3 font-extrabold uppercase tracking-[0.16em] text-[11px]">Seller</th>
                  <th className="px-4 py-3 font-extrabold uppercase tracking-[0.16em] text-[11px]">Amount</th>
                  <th className="px-4 py-3 font-extrabold uppercase tracking-[0.16em] text-[11px]">Provider</th>
                  <th className="px-4 py-3 font-extrabold uppercase tracking-[0.16em] text-[11px]">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredRows.map((row) => (
                  <tr key={row.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => setSelectedId(row.id)}>
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(row.status)}`}>
                          {formatStatus(row.status)}
                        </span>
                        {row.status === "held" || row.status === "failed" ? (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            <div className="font-black text-amber-950">Exact error</div>
                            <div className="mt-1 leading-5">
                              {row.lastError ?? row.holdReason ?? row.manualReviewReason ?? row.latestAttemptFailureReason ?? row.failureReason ?? "Awaiting detail"}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-zinc-600">{row.sellerId}</td>
                    <td className="px-4 py-4 text-zinc-600">
                      {Number(row.amount).toLocaleString()} {row.currency}
                    </td>
                    <td className="px-4 py-4 text-zinc-600">
                      <div className="space-y-1">
                        <div className="font-semibold text-zinc-900">{row.provider ?? "paychangu"}</div>
                        <div className="text-xs text-zinc-500">{row.providerReference ?? row.providerChargeId ?? "—"}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-zinc-600">{toDate(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selected ? (
        <PayoutDetailDrawer
          selected={selected}
          visibleActions={visibleActions}
          actionBusyId={actionBusyId}
          adjustments={adjustments}
          adjustmentsLoading={adjustmentsLoading}
          destinationStatus={destinationStatus}
          destinationReason={destinationReason}
          sellerControlReason={sellerControlReason}
          adjustmentType={adjustmentType}
          adjustmentAmount={adjustmentAmount}
          adjustmentReason={adjustmentReason}
          adjustmentProviderRef={adjustmentProviderRef}
          destinationStatusOptions={DESTINATION_STATUS_OPTIONS}
          adjustmentTypeOptions={ADJUSTMENT_TYPE_OPTIONS}
          canAction={canAction}
          statusTone={statusTone}
          formatStatus={formatStatus}
          toDate={toDate}
          onClose={() => setSelectedId(null)}
          onOpenRetryDialog={() => handleOpenDialog(selected, "retry")}
          onOpenOverrideDialog={(action) => handleOpenDialog(selected, "override", action)}
          onOpenReconcileDialog={() => handleOpenDialog(selected, "reconcile")}
          onOpenRefundEscrowDialog={() => setNotice({ type: "error", message: "Refund escrow is not wired in this build." })}
          isAdmin={isAdmin}
          onDestinationStatusChange={setDestinationStatus}
          onDestinationReasonChange={setDestinationReason}
          onUpdateDestinationVerification={handleUpdateDestinationVerification}
          onApproveDestinationVerification={handleApproveDestinationVerification}
          onSellerControlReasonChange={setSellerControlReason}
          onUpdateSellerSuspension={handleUpdateSellerSuspension}
          onReloadAdjustments={() => void loadAdjustments(selected.id)}
          onAdjustmentTypeChange={setAdjustmentType}
          onAdjustmentAmountChange={setAdjustmentAmount}
          onAdjustmentReasonChange={setAdjustmentReason}
          onAdjustmentProviderRefChange={setAdjustmentProviderRef}
          onCreateAdjustment={handleCreateAdjustment}
        />
      ) : null}

      {pendingDialog ? (
        <ActionModal
          open
          title={pendingDialog.title}
          message={pendingDialog.message}
          confirmLabel={pendingDialog.confirmLabel}
          danger={pendingDialog.danger}
          onCancel={closeActionDialog}
          onConfirm={handleConfirmDialog}
        />
      ) : null}
    </AdminWorkspaceLayout>
  );
}
