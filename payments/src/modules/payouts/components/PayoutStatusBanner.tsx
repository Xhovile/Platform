import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ShieldAlert,
  RefreshCw,
  MessageCircleQuestion,
} from 'lucide-react';
import {
  getSellerPayoutFailureMeta,
  getSellerPayoutStatusDetail,
  getSellerPayoutStatusLabel,
  sellerOperationalSignals,
} from '../uiModel';

export type PayoutStatusBannerProps = {
  status: string;
  failureReasonCode?: string | null;
  retryAllowed?: boolean | null;
  manualReviewPending?: boolean | null;
  destinationStatus?: string | null;
  verificationBlockers?: string[] | null;
  providerName?: string | null;
  updatedAt?: string | null;
  isAdmin?: boolean;
  onRetry?: () => void;
  onViewDetails?: () => void;
  onContactSupport?: () => void;
  className?: string;
};

function formatDateTime(value?: string | null): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function toneClasses(status: string): { wrapper: string; icon: React.ReactNode } {
  const normalized = String(status ?? '').toLowerCase();

  if (normalized === 'paid') {
    return {
      wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-950',
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
    };
  }

  if (normalized === 'held' || normalized === 'failed') {
    return {
      wrapper: 'border-amber-200 bg-amber-50 text-amber-950',
      icon: <AlertTriangle className="h-5 w-5 text-amber-600" />,
    };
  }

  if (normalized === 'cancelled') {
    return {
      wrapper: 'border-zinc-200 bg-zinc-50 text-zinc-950',
      icon: <ShieldAlert className="h-5 w-5 text-zinc-500" />,
    };
  }

  return {
    wrapper: 'border-sky-200 bg-sky-50 text-sky-950',
    icon: <Clock3 className="h-5 w-5 text-sky-600" />,
  };
}

export default function PayoutStatusBanner({
  status,
  failureReasonCode,
  retryAllowed,
  manualReviewPending,
  destinationStatus,
  verificationBlockers,
  providerName = 'PayChangu',
  updatedAt,
  isAdmin = false,
  onRetry,
  onViewDetails,
  onContactSupport,
  className = '',
}: PayoutStatusBannerProps) {
  const tone = toneClasses(status);
  const failureMeta = getSellerPayoutFailureMeta(failureReasonCode);
  const statusLabel = getSellerPayoutStatusLabel(status);
  const statusDetail = failureMeta?.detail ?? getSellerPayoutStatusDetail(status);
  const updatedLabel = formatDateTime(updatedAt);
  const signals = sellerOperationalSignals({
    status,
    failureReasonCode,
    retryAllowed,
    manualReviewPending,
    destinationStatus,
    verificationBlockers,
  });

  const showRetry = Boolean(onRetry) && retryAllowed !== false && String(status).toLowerCase() !== 'paid';
  const showSupport = Boolean(onContactSupport) && (String(status).toLowerCase() === 'held' || String(status).toLowerCase() === 'failed');
  const showDetails = Boolean(onViewDetails);

  return (
    <section className={`rounded-2xl border p-4 shadow-sm ${tone.wrapper} ${className}`.trim()}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/70 ring-1 ring-black/5">
          {tone.icon}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-current/60">
              Current payout status
            </p>
            <h3 className="mt-1 text-lg font-extrabold leading-tight text-current">
              {failureMeta?.label ?? statusLabel}
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-current/80">
              {statusDetail}
            </p>
          </div>

          <div className="grid gap-2 text-sm text-current/80 sm:grid-cols-2">
            <div className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-black/5">
              <span className="font-bold text-current">Payout provider:</span> {providerName}
            </div>
            {updatedLabel ? (
              <div className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-black/5">
                <span className="font-bold text-current">Last updated:</span> {updatedLabel}
              </div>
            ) : null}
            {manualReviewPending ? (
              <div className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-black/5">
                <span className="font-bold text-current">Next step:</span> Waiting for admin review
              </div>
            ) : null}
            {retryAllowed === false && String(status).toLowerCase() === 'failed' ? (
              <div className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-black/5">
                <span className="font-bold text-current">Retry:</span> Not available
              </div>
            ) : null}
          </div>

          {verificationBlockers?.length ? (
            <div className="rounded-2xl border border-current/10 bg-white/60 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-current/60">
                Why this payout is paused
              </p>
              <ul className="mt-2 space-y-1 text-sm text-current/80">
                {verificationBlockers.map((blocker) => (
                  <li key={blocker} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-current/50" />
                    <span>{blocker}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {signals.length > 0 ? (
            <div className="flex flex-wrap gap-2">
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

          <div className="flex flex-wrap gap-2 pt-1">
            {showRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-zinc-900 shadow-sm ring-1 ring-black/5 transition hover:bg-zinc-50"
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
            ) : null}

            {showDetails ? (
              <button
                type="button"
                onClick={onViewDetails}
                className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-black/85"
              >
                <MessageCircleQuestion className="h-4 w-4" />
                Open payout details
              </button>
            ) : null}

            {showSupport ? (
              <button
                type="button"
                onClick={onContactSupport}
                className="inline-flex items-center gap-2 rounded-xl bg-white/80 px-4 py-2 text-sm font-bold text-current shadow-sm ring-1 ring-black/5 transition hover:bg-white"
              >
                Get help
              </button>
            ) : null}
          </div>

          {isAdmin ? (
            <p className="text-xs font-medium text-current/60">
              Admin view can also reveal the raw reason code and provider response.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
