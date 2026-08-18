import { CheckCircle2, Circle, Clock3, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  getSellerPayoutFailureMeta,
  getSellerPayoutStatusDetail,
  getSellerPayoutStatusLabel,
  sellerOperationalSignals,
} from "../../modules/payouts/uiModel";
import type { PayoutRecord } from "../../modules/payouts/types";

type PayoutTimelineProps = {
  payouts: PayoutRecord[];
};

type StepState = "done" | "active" | "warning" | "pending";

type Step = {
  key: string;
  label: string;
  detail: string;
  state: StepState;
};

function getLatestPayout(payouts: PayoutRecord[]) {
  if (!Array.isArray(payouts) || payouts.length === 0) return null;

  return [...payouts].sort((a, b) => {
    const aTime = new Date(a.updatedAt ?? a.createdAt ?? a.requestedAt ?? 0).getTime();
    const bTime = new Date(b.updatedAt ?? b.createdAt ?? b.requestedAt ?? 0).getTime();
    return bTime - aTime;
  })[0] ?? null;
}

function stepIcon(state: StepState) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === "warning") return <TriangleAlert className="h-4 w-4 text-amber-600" />;
  if (state === "active") return <Clock3 className="h-4 w-4 text-indigo-600" />;
  return <Circle className="h-4 w-4 text-zinc-400" />;
}

export default function PayoutTimeline({ payouts }: PayoutTimelineProps) {
  const latest = getLatestPayout(payouts);
  const status = String(latest?.status ?? "eligible").toLowerCase();
  const failureReasonSource = latest?.lastFailureReason ?? latest?.holdReason ?? null;
  const failureMeta = getSellerPayoutFailureMeta(failureReasonSource);
  const title = failureMeta?.label ?? getSellerPayoutStatusLabel(status);
  const detail = failureMeta?.detail ?? getSellerPayoutStatusDetail(status);
  const manualReview = Boolean(latest?.manualReviewReason);
  const signals = sellerOperationalSignals({
    status,
    failureReasonCode: failureReasonSource,
    retryAllowed: latest?.retryEligible ?? null,
    manualReviewPending: manualReview,
    destinationStatus: latest?.destinationVerificationStatus ?? null,
    verificationBlockers: latest?.verificationBlockers ?? null,
  });

  const paid = status === "paid";
  const blocked = status === "held" || status === "failed";

  const steps: Step[] = [
    {
      key: "buyer-paid",
      label: "Buyer paid",
      detail: "Customer funds were captured successfully.",
      state: latest ? "done" : "active",
    },
    {
      key: "escrow-created",
      label: "Escrow created",
      detail: "Funds were placed in escrow and are waiting for release.",
      state: latest ? "done" : "pending",
    },
    {
      key: "order-released",
      label: "Order released",
      detail: latest
        ? "The order moved from escrow into the payout flow."
        : "The order has not yet been released into payout processing.",
      state: latest ? "done" : "pending",
    },
    {
      key: "provider",
      label: blocked ? (failureMeta?.label ?? "Payout paused") : "Payout processing",
      detail: blocked
        ? detail
        : paid
          ? "The payout completed successfully."
          : "The provider is processing the transfer.",
      state: paid ? "done" : blocked ? "warning" : latest ? "active" : "pending",
    },
    {
      key: "result",
      label: paid ? "Funds received" : "Awaiting completion",
      detail: paid
        ? "The seller destination received the payout."
        : "The payout has not reached the seller yet.",
      state: paid ? "done" : "pending",
    },
  ];

  return (
    <section className="rounded-[1.75rem] border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-400">
            Payout timeline
          </p>
          <h3 className="mt-2 text-lg font-black tracking-tight text-zinc-900">
            {paid ? "Payout complete" : blocked ? "Payout stopped here" : "Payout in progress"}
          </h3>
        </div>
        <div className="rounded-full bg-zinc-100 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-zinc-600">
          {status || "unknown"}
        </div>
      </div>

      {latest ? (
        <div
          className={`mt-4 rounded-2xl border p-4 ${
            paid
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : blocked
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-sky-200 bg-sky-50 text-sky-950"
          }`}
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-current/60">
            Current payout status
          </p>
          <h4 className="mt-1 text-lg font-extrabold leading-tight text-current">
            {title}
          </h4>
          <p className="mt-1 text-sm leading-6 text-current/80">{detail}</p>

          <div className="mt-3 grid gap-2 text-sm text-current/80 sm:grid-cols-2">
            <div className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-black/5">
              <span className="font-bold text-current">Payout provider:</span>{" "}
              {latest.provider ?? "PayChangu"}
            </div>
            <div className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-black/5">
              <span className="font-bold text-current">Last updated:</span>{" "}
              {new Date(latest.updatedAt ?? latest.createdAt).toLocaleString()}
            </div>
            {manualReview ? (
              <div className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-black/5 sm:col-span-2">
                <span className="font-bold text-current">Next step:</span> Waiting for admin review
              </div>
            ) : null}
            {failureMeta ? (
              <div className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-black/5 sm:col-span-2">
                <span className="font-bold text-current">Exact issue:</span> {failureMeta.label}
                <div className="mt-1 text-xs leading-5 text-current/70">{failureMeta.detail}</div>
              </div>
            ) : blocked ? (
              <div className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-black/5 sm:col-span-2">
                <span className="font-bold text-current">Exact issue:</span> {detail}
              </div>
            ) : null}
          </div>

          {failureReasonSource ? (
            <div className="mt-3 rounded-2xl border border-current/10 bg-white/60 px-3 py-2 text-xs font-semibold text-current/70">
              <span className="font-bold text-current/85">Reason code / source:</span>{" "}
              {failureReasonSource}
            </div>
          ) : null}

          {signals.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {signals.slice(0, 4).map((signal) => (
                <span
                  key={signal}
                  className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold text-current/80 ring-1 ring-black/5"
                >
                  {signal}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {steps.map((step, index) => (
          <div key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-50 ring-1 ring-zinc-200">
                {stepIcon(step.state)}
              </div>
              {index < steps.length - 1 ? (
                <div className="mt-1 h-full min-h-8 w-px bg-zinc-200" />
              ) : null}
            </div>

            <div className="min-w-0 pb-1">
              <p className="text-sm font-bold text-zinc-900">{step.label}</p>
              <p className="mt-1 text-sm text-zinc-500">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-zinc-500">
        <ShieldCheck className="h-4 w-4" />
        During launch, payouts are automatically queued after escrow release.
      </p>
    </section>
  );
}
