import { useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { apiFetch } from "./lib/api";
import PayoutDetailDrawer from "./PayoutDetailDrawer";
import { classifyPayoutDiagnostic } from "./modules/payouts/diagnostics";

type Props = ComponentProps<typeof PayoutDetailDrawer>;
type Banner = { type: "success" | "error"; message: string };

function pickReason(...values: Array<string | null | undefined>) {
  return values.map((value) => String(value ?? "").trim()).find((value) => value.length > 0) ?? "Admin action";
}

export default function AdminPayoutDetailDrawer(props: Props) {
  const { selected } = props;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Banner | null>(null);

  const primaryDiagnostic = classifyPayoutDiagnostic(selected);
  const bannerReason = primaryDiagnostic.message;
  const bannerLabel = primaryDiagnostic.classification === "none" ? null : primaryDiagnostic.label;

  const safeVisibleActions = useMemo(
    () => props.visibleActions.filter((action) => action !== "refund_escrow"),
    [props.visibleActions],
  );

  const actionBusyId = busy ? selected.id : props.actionBusyId;

  const runAction = async (successMessage: string, task: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      await task();
      setNotice({ type: "success", message: successMessage });
      window.setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Action failed.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    if (!window.confirm(`Retry payout ${selected.id}?`)) return;
    await runAction("Payout retried.", () =>
      apiFetch(`/api/admin/payouts/${encodeURIComponent(selected.id)}/retry`, {
        method: "POST",
        body: JSON.stringify({ payoutId: selected.id, sellerId: selected.sellerId }),
      }),
    );
  };

  const handleReconcile = async () => {
    if (!window.confirm(`Reconcile payout ${selected.id}?`)) return;
    await runAction("Payout reconciled.", () =>
      apiFetch(`/api/admin/payouts/${encodeURIComponent(selected.id)}/reconcile`, {
        method: "POST",
      }),
    );
  };

  const handleRefundEscrow = async () => {
    setNotice({
      type: "error",
      message: "Refund escrow is not wired yet. Hide this action or add the backend route before enabling it.",
    });
  };

  const handleOverride = async (action: Parameters<NonNullable<Props["onOpenOverrideDialog"]>>[0]) => {
    const label = action.replace(/_/g, " ");
    if (!window.confirm(`Apply ${label} to payout ${selected.id}?`)) return;

    const reason = pickReason(
      props.sellerControlReason,
      props.destinationReason,
      selected.manualReviewReason,
      selected.lastError,
      selected.failureReason,
      `Admin ${label}`,
    );

    await runAction("Payout updated.", () =>
      apiFetch(`/api/admin/payouts/${encodeURIComponent(selected.id)}/override`, {
        method: "POST",
        body: JSON.stringify({
          payoutId: selected.id,
          sellerId: selected.sellerId,
          action,
          reason,
        }),
      }),
    );
  };

  const handleDestinationVerification = async () => {
    if (!selected.destinationAccountId) {
      setNotice({ type: "error", message: "This payout does not have a destination account attached." });
      return;
    }

    const status = String(props.destinationStatus ?? selected.destinationVerificationStatus ?? "").trim().toLowerCase();
    if (!["pending", "verified", "failed", "disabled"].includes(status)) {
      setNotice({ type: "error", message: "Choose a valid destination verification status first." });
      return;
    }

    const reason = pickReason(props.destinationReason, selected.destinationLastError, `Admin set destination to ${status}`);

    await runAction("Destination verification updated.", () =>
      apiFetch(`/api/admin/payouts/destinations/${encodeURIComponent(selected.destinationAccountId as string)}/verification`, {
        method: "POST",
        body: JSON.stringify({ status, reason }),
      }),
    );
  };

  const handleApproveDestinationVerification = async () => {
    if (!selected.destinationAccountId) {
      setNotice({ type: "error", message: "This payout does not have a destination account attached." });
      return;
    }

    await runAction("Destination approved.", () =>
      apiFetch(`/api/admin/payouts/destinations/${encodeURIComponent(selected.destinationAccountId as string)}/verification`, {
        method: "POST",
        body: JSON.stringify({
          status: "verified",
          reason: pickReason(props.destinationReason, "Destination approved by admin"),
        }),
      }),
    );
  };

  const handleSellerSuspension = async (suspended: boolean) => {
    const reason = pickReason(props.sellerControlReason, selected.manualReviewReason, selected.lastError, suspended ? "Admin suspension" : "Admin unsuspension");

    await runAction(suspended ? "Seller payouts suspended." : "Seller payouts unsuspended.", () =>
      apiFetch(`/api/admin/payouts/sellers/${encodeURIComponent(selected.sellerId)}/suspension`, {
        method: "POST",
        body: JSON.stringify({ suspended, reason }),
      }),
    );
  };

  const handleCreateAdjustment = async () => {
    const amount = Number(props.adjustmentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice({ type: "error", message: "Enter a valid positive adjustment amount." });
      return;
    }

    const reason = pickReason(props.adjustmentReason, "Manual payout adjustment");

    await runAction("Adjustment created.", () =>
      apiFetch(`/api/admin/payouts/${encodeURIComponent(selected.id)}/adjustments`, {
        method: "POST",
        body: JSON.stringify({
          adjustmentType: props.adjustmentType,
          amount,
          reason,
          providerReference: props.adjustmentProviderRef || undefined,
        }),
      }),
    );
  };

  return (
    <>
      {bannerReason ? (
        <div className="fixed right-4 top-4 z-[95] w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-2xl">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">
            Primary payout blocker{bannerLabel ? ` · ${bannerLabel}` : ""}
          </p>
          <p className="mt-1 break-words font-semibold leading-relaxed">{bannerReason}</p>
        </div>
      ) : null}

      {notice ? (
        <div
          className={`fixed left-4 top-4 z-[96] w-[min(28rem,calc(100vw-2rem))] rounded-2xl border px-4 py-3 text-sm font-semibold shadow-2xl ${
            notice.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {notice.message}
        </div>
      ) : null}

      <PayoutDetailDrawer
        {...props}
        visibleActions={safeVisibleActions}
        actionBusyId={actionBusyId}
        onOpenRetryDialog={() => void handleRetry()}
        onOpenOverrideDialog={(action) => void handleOverride(action)}
        onOpenReconcileDialog={() => void handleReconcile()}
        onOpenRefundEscrowDialog={() => void handleRefundEscrow()}
        onUpdateDestinationVerification={() => void handleDestinationVerification()}
        onApproveDestinationVerification={() => void handleApproveDestinationVerification()}
        onUpdateSellerSuspension={(suspended) => void handleSellerSuspension(suspended)}
        onCreateAdjustment={() => void handleCreateAdjustment()}
      />
    </>
  );
}
