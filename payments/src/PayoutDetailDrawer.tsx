import type { ReactNode } from "react";
import { CircleAlert, Loader2, RefreshCw, ShieldCheck, Wallet, X } from "lucide-react";
import FormDropdown from "./components/FormDropdown";
import type { OverrideAction, PayoutAdjustment, PayoutRow, RowAction } from "./AdminPayoutsManager";
import { classifyPayoutDiagnostic, getPayoutDiagnostics } from "./modules/payouts/diagnostics";

type PayoutDetailDrawerProps = {
  selected: PayoutRow;
  visibleActions: string[];
  actionBusyId: string | null;
  adjustments: PayoutAdjustment[];
  adjustmentsLoading: boolean;
  destinationStatus: string;
  destinationReason: string;
  sellerControlReason: string;
  adjustmentType: "processing_fee" | "manual_adjustment";
  adjustmentAmount: string;
  adjustmentReason: string;
  adjustmentProviderRef: string;
  destinationStatusOptions: readonly { value: string; label: string }[];
  adjustmentTypeOptions: readonly { value: "manual_adjustment" | "processing_fee"; label: string }[];
  canAction: (row: PayoutRow, action: RowAction) => boolean;
  statusTone: (status: string) => string;
  formatStatus: (value: string | null | undefined) => string;
  toDate: (value: string | null | undefined) => string;
  onClose: () => void;
  onOpenRetryDialog: () => void;
  onOpenOverrideDialog: (action: OverrideAction, confirmLabel: string) => void;
  onOpenReconcileDialog: () => void;
  onOpenRefundEscrowDialog: () => void;
  isAdmin: boolean;
  onDestinationStatusChange: (value: string) => void;
  onDestinationReasonChange: (value: string) => void;
  onUpdateDestinationVerification: () => void;
  onApproveDestinationVerification: () => void;
  onSellerControlReasonChange: (value: string) => void;
  onUpdateSellerSuspension: (suspended: boolean) => void;
  onReloadAdjustments: () => void;
  onAdjustmentTypeChange: (value: "processing_fee" | "manual_adjustment") => void;
  onAdjustmentAmountChange: (value: string) => void;
  onAdjustmentReasonChange: (value: string) => void;
  onAdjustmentProviderRefChange: (value: string) => void;
  onCreateAdjustment: () => void;
};

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">{label}</p>
      <p className="mt-1 break-all font-medium text-zinc-900">{value}</p>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${tone}`}>{label}</span>;
}

function AccordionSection({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="rounded-[2rem] border border-zinc-200 bg-white shadow-sm" open={defaultOpen}>
      <summary className="cursor-pointer list-none rounded-[2rem] px-5 py-4 outline-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-base font-black text-zinc-950">{title}</h4>
            {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
          </div>
          <span className="mt-1 inline-flex shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-bold text-zinc-600">
            Toggle
          </span>
        </div>
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );
}

export default function PayoutDetailDrawer({
  selected,
  visibleActions,
  actionBusyId,
  adjustments,
  adjustmentsLoading,
  destinationStatus,
  destinationReason,
  sellerControlReason,
  adjustmentType,
  adjustmentAmount,
  adjustmentReason,
  adjustmentProviderRef,
  destinationStatusOptions,
  adjustmentTypeOptions,
  canAction,
  statusTone,
  formatStatus,
  toDate,
  onClose,
  onOpenRetryDialog,
  onOpenOverrideDialog,
  onOpenReconcileDialog,
  onOpenRefundEscrowDialog,
  isAdmin,
  onDestinationStatusChange,
  onDestinationReasonChange,
  onUpdateDestinationVerification,
  onApproveDestinationVerification,
  onSellerControlReasonChange,
  onUpdateSellerSuspension,
  onReloadAdjustments,
  onAdjustmentTypeChange,
  onAdjustmentAmountChange,
  onAdjustmentReasonChange,
  onAdjustmentProviderRefChange,
  onCreateAdjustment,
}: PayoutDetailDrawerProps) {
  const exactDiagnostics = getPayoutDiagnostics(selected);
  const primaryDiagnostic = classifyPayoutDiagnostic(selected);
  const formattedDiagnostics = Object.entries(exactDiagnostics);
  const destinationVerified =
    String(selected.destinationVerificationStatus ?? "").toLowerCase() === "verified" &&
    selected.destinationActive !== false;
  const canApproveDestination = !!selected.destinationAccountId && !destinationVerified;
  const escrowState = String(selected.escrowState ?? "").toLowerCase();
  const canRefundEscrow =
    isAdmin &&
    Boolean(selected.orderId) &&
    Boolean(selected.escrowId) &&
    escrowState !== "released" &&
    escrowState !== "refunded" &&
    escrowState !== "closed";

  const verificationBlockers = Array.isArray(selected.verificationBlockers) ? selected.verificationBlockers.filter(Boolean) : [];
  const manualBlockers = [
    selected.holdReason,
    selected.manualReviewReason,
    selected.retryBlockedReason,
    selected.lastError,
    selected.latestAttemptFailureReason,
  ].filter((value): value is string => Boolean(value));
  const providerStatus = selected.providerStatus ? formatStatus(selected.providerStatus) : "—";
  const providerReference = selected.providerReference ?? "—";
  const providerTransactionId = selected.providerTransactionId ?? "—";
  const latestWebhook = selected.latestWebhookEventType
    ? `${formatStatus(selected.latestWebhookEventType)}${selected.latestWebhookEventAt ? ` · ${toDate(selected.latestWebhookEventAt)}` : ""}`
    : "—";
  const nextAction = selected.retryEligible
    ? "Retry payout"
    : verificationBlockers.length > 0
      ? "Fix destination verification"
      : selected.sellerSuspended
        ? "Unsuspend seller"
        : manualBlockers.length > 0
          ? "Review hold reason"
          : "Manual review";

  return (
    <div className="fixed inset-0 z-[90] flex bg-zinc-900/50 backdrop-blur-sm" onClick={onClose}>
      <aside className="ml-auto h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Payout detail</p>
              <h3 className="mt-1 text-lg font-black text-zinc-950">{selected.id}</h3>
            </div>
            <button type="button" onClick={onClose} className="rounded-2xl border border-zinc-200 p-2 hover:bg-zinc-50">
              <X className="h-5 w-5 text-zinc-500" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill label={formatStatus(selected.status)} tone={statusTone(selected.status)} />
            {selected.retryEligible ? (
              <StatusPill label="retry eligible" tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
            ) : (
              <StatusPill label={selected.retryBlockedReason ?? "retry unavailable"} tone="border-zinc-200 bg-white text-zinc-600" />
            )}
            <StatusPill label={`destination ${formatStatus(selected.destinationVerificationStatus)}`} tone="border-zinc-200 bg-white text-zinc-700" />
            <StatusPill
              label={selected.sellerSuspended ? "seller suspended" : "seller active"}
              tone={selected.sellerSuspended ? "border-rose-200 bg-rose-50 text-rose-700" : "border-zinc-200 bg-zinc-100 text-zinc-700"}
            />
          </div>
        </div>

        <div className="space-y-5 p-5">
          <AccordionSection title="Payout summary" description="Core payout details at a glance." defaultOpen>
            <div className="grid gap-2 sm:grid-cols-2">
              <Info label="Payout ID" value={selected.id} />
              <Info label="Seller ID" value={selected.sellerId} />
              <Info label="Order ID" value={selected.orderId ?? "—"} />
              <Info label="Escrow ID" value={selected.escrowId ?? "—"} />
              <Info label="Release entry ID" value={selected.releaseEntryId ?? "—"} />
              <Info label="Amount" value={`${selected.currency} ${Number(selected.amount).toLocaleString()}`} />
              <Info label="Requested by" value={selected.requestedBy ?? "—"} />
              <Info label="Destination" value={selected.destinationMaskedAccount ?? "—"} />
              <Info label="Destination type" value={formatStatus(selected.destinationType)} />
              <Info label="Destination active" value={selected.destinationActive ? "Yes" : "No"} />
              <Info label="Retry eligibility" value={selected.retryEligible ? "Can retry safely" : selected.retryBlockedReason ?? "Retry unavailable"} />
            </div>
          </AccordionSection>

          <AccordionSection title="Admin resolution snapshot" description="Exactly what is blocking the payout." defaultOpen>
            <div className="grid gap-2 sm:grid-cols-2">
              <Info label="Next action" value={nextAction} />
              <Info label="Provider status" value={providerStatus} />
              <Info label="Provider reference" value={providerReference} />
              <Info label="Provider transaction ID" value={providerTransactionId} />
              <Info label="Latest webhook" value={latestWebhook} />
              <Info label="Latest attempt failure" value={selected.latestAttemptFailureReason ?? "—"} />
              <Info label="Hold reason" value={selected.holdReason ?? "—"} />
              <Info label="Manual review reason" value={selected.manualReviewReason ?? "—"} />
            </div>

            {verificationBlockers.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-800">
                <p className="font-black text-rose-950">Destination blockers</p>
                <ul className="mt-2 space-y-1">
                  {verificationBlockers.map((blocker) => (
                    <li key={blocker}>• {blocker}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {manualBlockers.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
                <p className="font-black text-zinc-950">Operational blockers</p>
                <ul className="mt-2 space-y-1">
                  {manualBlockers.map((blocker) => (
                    <li key={blocker}>• {blocker}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </AccordionSection>

          <AccordionSection title="Exact diagnostics" description="Actual backend payout state, attempts, events, and raw debug payload." defaultOpen>
            {primaryDiagnostic.message ? (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">{primaryDiagnostic.label}</p>
                <p className="mt-1 font-bold">{primaryDiagnostic.message}</p>
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {formattedDiagnostics.map(([key, value]) => (
                <Info key={key} label={key} value={value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)} />
              ))}
            </div>
            <details className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-950 px-4 py-3 text-zinc-100">
              <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.18em] text-zinc-300">Raw JSON/debug view</summary>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(exactDiagnostics, null, 2)}</pre>
            </details>
          </AccordionSection>

          <AccordionSection title="Destination verification" description="Edit routing status and error reason.">
            <div className="grid gap-2">
              <Info label="Destination ID" value={selected.destinationAccountId ?? "—"} />
              <Info label="Current status" value={formatStatus(selected.destinationVerificationStatus)} />
              <Info label="Last destination error" value={selected.destinationLastError ?? "—"} />
            </div>

            {canApproveDestination ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-black">Destination must be verified before payout release.</p>
                    <p className="mt-1 text-emerald-700">Approve this destination as verified and keep it active for the payout gate.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onApproveDestinationVerification}
                  disabled={actionBusyId === selected.id}
                  className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {actionBusyId === selected.id ? "Approving..." : "Approve as verified"}
                </button>
              </div>
            ) : null}

            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <FormDropdown
                label="Destination status"
                value={destinationStatus}
                options={destinationStatusOptions}
                onChange={onDestinationStatusChange}
                placeholder="Select destination status"
                searchPlaceholder="Search status..."
                disabled={!selected.destinationAccountId || actionBusyId === selected.id}
              />
              <input
                value={destinationReason}
                onChange={(event) => onDestinationReasonChange(event.target.value)}
                placeholder="Reason (required for failed/disabled)"
                className="rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm"
                disabled={!selected.destinationAccountId || actionBusyId === selected.id}
              />
              <button
                type="button"
                onClick={onUpdateDestinationVerification}
                disabled={!selected.destinationAccountId || actionBusyId === selected.id}
                className="rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {actionBusyId === selected.id ? "Saving..." : "Update"}
              </button>
            </div>
          </AccordionSection>

          {canRefundEscrow ? (
            <AccordionSection title="Escrow actions" description="Use only when escrow is still unreleased.">
              <p className="text-sm text-rose-800">
                Record an escrow refund only when the order still has unreleased escrow funds. A confirmation reason is required before the held escrow balance is settled.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Info label="Order ID" value={selected.orderId ?? "—"} />
                <Info label="Escrow ID" value={selected.escrowId ?? "—"} />
                <Info label="Escrow state" value={formatStatus(selected.escrowState)} />
              </div>
              <button
                type="button"
                onClick={onOpenRefundEscrowDialog}
                disabled={actionBusyId === selected.id}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {actionBusyId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleAlert className="h-4 w-4" />}
                Record refund
              </button>
            </AccordionSection>
          ) : null}

          <AccordionSection title="Payout lifecycle timeline" description="Audit timestamps without leaving the drawer.">
            <div className="grid gap-2 sm:grid-cols-2">
              <Info label="Created at" value={toDate(selected.createdAt)} />
              <Info label="Requested at" value={toDate(selected.requestedAt)} />
              <Info label="Sent at" value={toDate(selected.sentAt)} />
              <Info label="Paid at" value={toDate(selected.paidAt)} />
              <Info label="Failed at" value={toDate(selected.failedAt)} />
              <Info label="Updated at" value={toDate(selected.updatedAt)} />
            </div>
          </AccordionSection>

          <AccordionSection title="Payout actions" description="Retry, hold, mark paid, or reconcile from here.">
            <div className="flex flex-wrap gap-2">
              {visibleActions.includes("retry") ? (
                <button
                  type="button"
                  disabled={actionBusyId === selected.id || !canAction(selected, "retry")}
                  onClick={onOpenRetryDialog}
                  className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {actionBusyId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Retry
                </button>
              ) : null}
              {visibleActions.includes("hold") ? (
                <button
                  type="button"
                  disabled={actionBusyId === selected.id || !canAction(selected, "hold")}
                  onClick={() => onOpenOverrideDialog("hold", "hold")}
                  className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {actionBusyId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Hold
                </button>
              ) : null}
              {visibleActions.includes("mark_paid") ? (
                <button
                  type="button"
                  disabled={actionBusyId === selected.id || !canAction(selected, "mark_paid")}
                  onClick={() => onOpenOverrideDialog("mark_paid", "mark paid")}
                  className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {actionBusyId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                  Mark paid
                </button>
              ) : null}
              {visibleActions.includes("mark_failed") ? (
                <button
                  type="button"
                  disabled={actionBusyId === selected.id || !canAction(selected, "mark_failed")}
                  onClick={() => onOpenOverrideDialog("mark_failed", "mark failed")}
                  className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {actionBusyId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleAlert className="h-4 w-4" />}
                  Mark failed
                </button>
              ) : null}
              {visibleActions.includes("cancel") ? (
                <button
                  type="button"
                  disabled={actionBusyId === selected.id || !canAction(selected, "cancel")}
                  onClick={() => onOpenOverrideDialog("cancel", "cancel")}
                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  {actionBusyId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                disabled={actionBusyId === selected.id}
                onClick={onOpenReconcileDialog}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              >
                {actionBusyId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Reconcile
              </button>
            </div>
          </AccordionSection>

          <AccordionSection title="Seller payout suspension" description="Suspend or restore seller payout access.">
            <p className="text-sm text-zinc-600">
              Current state: <span className="font-semibold text-zinc-900">{selected.sellerSuspended ? "Suspended" : "Active"}</span>
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <input
                value={sellerControlReason}
                onChange={(event) => onSellerControlReasonChange(event.target.value)}
                placeholder="Reason (required)"
                className="rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm"
                disabled={actionBusyId === selected.id}
              />
              <button
                type="button"
                onClick={() => onUpdateSellerSuspension(true)}
                disabled={actionBusyId === selected.id}
                className="rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Suspend
              </button>
              <button
                type="button"
                onClick={() => onUpdateSellerSuspension(false)}
                disabled={actionBusyId === selected.id}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 disabled:opacity-50"
              >
                Unsuspend
              </button>
            </div>
          </AccordionSection>

          <AccordionSection title="Payout adjustments" description="Legacy compatibility and manual corrections stay tucked away.">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-zinc-600">Refresh and add adjustments only when necessary.</p>
              <button type="button" onClick={onReloadAdjustments} className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700">
                Refresh adjustments
              </button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Info label="Gross" value={`${selected.currency} ${Number(selected.grossAmount ?? 0).toLocaleString()}`} />
              <Info label="Net" value={`${selected.currency} ${Number(selected.netAmount ?? selected.amount).toLocaleString()}`} />
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr]">
              <FormDropdown
                label="Adjustment type"
                value={adjustmentType}
                options={adjustmentTypeOptions}
                onChange={(value) => onAdjustmentTypeChange(value as "processing_fee" | "manual_adjustment")}
                placeholder="Select adjustment type"
                searchPlaceholder="Search adjustment type..."
                disabled={actionBusyId === selected.id}
              />
              <input
                value={adjustmentAmount}
                onChange={(event) => onAdjustmentAmountChange(event.target.value)}
                placeholder="Amount"
                className="rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm"
                disabled={actionBusyId === selected.id}
              />
              <input
                value={adjustmentReason}
                onChange={(event) => onAdjustmentReasonChange(event.target.value)}
                placeholder="Reason"
                className="rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm"
                disabled={actionBusyId === selected.id}
              />
              <input
                value={adjustmentProviderRef}
                onChange={(event) => onAdjustmentProviderRefChange(event.target.value)}
                placeholder="Provider reference (optional)"
                className="rounded-2xl border border-zinc-200 px-3 py-2.5 text-sm"
                disabled={actionBusyId === selected.id}
              />
            </div>

            <button
              type="button"
              onClick={onCreateAdjustment}
              disabled={actionBusyId === selected.id}
              className="mt-3 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Save adjustment
            </button>

            <div className="mt-4 space-y-2">
              {adjustmentsLoading ? (
                <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading adjustments...
                </div>
              ) : adjustments.length === 0 ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-600">No adjustments recorded for this payout.</div>
              ) : (
                adjustments.map((adjustment) => (
                  <div key={adjustment.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-700">
                    <p className="font-bold text-zinc-950">
                      {adjustment.adjustmentType.replace(/_/g, " ")} · {adjustment.currency} {Number(adjustment.amount).toLocaleString()}
                    </p>
                    <p className="mt-1">{adjustment.reason}</p>
                    <p className="mt-1 text-xs text-zinc-500">{toDate(adjustment.createdAt)} · {adjustment.actorType}</p>
                  </div>
                ))
              )}
            </div>
          </AccordionSection>
        </div>
      </aside>
    </div>
  );
  }
