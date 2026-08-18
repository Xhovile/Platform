type PayoutStatusBadgeKind = "payout" | "destination" | "destination_state";

type PayoutStatusBadgeProps = {
  status: string | boolean;
  kind?: PayoutStatusBadgeKind;
  className?: string;
};

const PAYOUT_STATUS_META: Record<string, { label: string; className: string }> = {
  paid: { label: "Paid", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  failed: { label: "Failed", className: "border-red-200 bg-red-50 text-red-700" },
  cancelled: { label: "Cancelled", className: "border-zinc-200 bg-zinc-100 text-zinc-700" },
  eligible: { label: "Eligible", className: "border-amber-200 bg-amber-50 text-amber-700" },
  queued: { label: "Queued for review", className: "border-amber-200 bg-amber-50 text-amber-700" },
  processing: { label: "Sent to provider", className: "border-amber-200 bg-amber-50 text-amber-700" },
  pending: { label: "Provider pending", className: "border-amber-200 bg-amber-50 text-amber-700" },
  held: { label: "Held for review", className: "border-amber-200 bg-amber-50 text-amber-700" },
};

const DESTINATION_STATUS_META: Record<string, { label: string; className: string }> = {
  verified: { label: "Verified", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  pending: { label: "Pending", className: "border-amber-200 bg-amber-50 text-amber-700" },
  failed: { label: "Failed", className: "border-red-200 bg-red-50 text-red-700" },
  unverified: { label: "Unverified", className: "border-zinc-200 bg-zinc-100 text-zinc-700" },
};

const DESTINATION_STATE_META: Record<string, { label: string; className: string }> = {
  default: { label: "Default", className: "border-sky-200 bg-sky-50 text-sky-700" },
  active: { label: "Active", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  inactive: { label: "Inactive", className: "border-zinc-200 bg-zinc-100 text-zinc-700" },
};

function toTitleLabel(status: string) {
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getPayoutStatusBadgeMeta(status: string | boolean, kind: PayoutStatusBadgeKind = "payout") {
  const normalized = typeof status === "boolean" ? (status ? "active" : "inactive") : status.toLowerCase();
  const dictionary = kind === "destination" ? DESTINATION_STATUS_META : kind === "destination_state" ? DESTINATION_STATE_META : PAYOUT_STATUS_META;
  return dictionary[normalized] ?? {
    label: typeof status === "boolean" ? (status ? "Active" : "Inactive") : toTitleLabel(status),
    className: "border-zinc-200 bg-zinc-100 text-zinc-700",
  };
}

export default function PayoutStatusBadge({ status, kind = "payout", className = "" }: PayoutStatusBadgeProps) {
  const meta = getPayoutStatusBadgeMeta(status, kind);

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${meta.className} ${className}`}>
      {meta.label}
    </span>
  );
}
