import { Building2, ChevronRight, Phone, ShieldCheck, Trash2 } from "lucide-react";
import PayoutStatusBadge from "./PayoutStatusBadge";
import type { PayoutDestinationType } from "./PayoutDestinationForm";

export type PayoutDestinationCardData = {
  id: string;
  sellerId: string;
  destinationType: PayoutDestinationType;
  providerName: string;
  providerRefId: string | null;
  currency: string;
  accountName: string;
  maskedAccount: string;
  isDefault: boolean;
  verificationStatus: string;
  verificationAttempts: number;
  lastError: string | null;
  verifiedAt: string | null;
  replacedFromId: string | null;
  replacedById: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type PayoutDestinationCardProps = {
  destination: PayoutDestinationCardData;
  onReplace?: (destination: PayoutDestinationCardData) => void;
  onRemove?: (destination: PayoutDestinationCardData) => void;
  onMakeDefault?: (destination: PayoutDestinationCardData) => void;
  formatDate?: (value: string | null) => string;
  actionsDisabled?: boolean;
};

function defaultFormatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function MetaBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-zinc-400">{label}</p>
      <p className="mt-1 truncate font-bold text-zinc-700">{value}</p>
    </div>
  );
}

export default function PayoutDestinationCard({
  destination,
  onReplace,
  onRemove,
  onMakeDefault,
  formatDate = defaultFormatDate,
  actionsDisabled = false,
}: PayoutDestinationCardProps) {
  const accountLabel = destination.maskedAccount || "Masked details unavailable";
  const canMakeDefault = Boolean(onMakeDefault) && destination.isActive && !destination.isDefault;
  const canReplace = Boolean(onReplace) && destination.isActive;
  const canRemove = Boolean(onRemove) && destination.isActive;

  return (
    <article className="w-full min-w-0 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PayoutStatusBadge status={destination.verificationStatus || "unverified"} kind="destination" />
            <PayoutStatusBadge status={destination.isActive} kind="destination_state" />
            {destination.isDefault ? <PayoutStatusBadge status="default" kind="destination_state" /> : null}
          </div>

          <h3 className="mt-3 text-base font-black tracking-tight">{destination.providerName}</h3>
          <p className="mt-1 text-sm font-bold text-zinc-700">{destination.accountName}</p>
          <p className="mt-1 flex items-center gap-2 text-sm text-zinc-600">
            {destination.destinationType === "bank" ? (
              <Building2 className="w-4 h-4 shrink-0" />
            ) : (
              <Phone className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">
              {destination.destinationType === "bank" ? "Bank" : "Mobile money"} · {accountLabel}
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => onReplace?.(destination)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          disabled={actionsDisabled || !canReplace}
        >
          Replace
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-zinc-500">
        <MetaBox label="Updated" value={formatDate(destination.updatedAt)} />
        <MetaBox label="Verified" value={formatDate(destination.verifiedAt)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onMakeDefault?.(destination)}
          disabled={actionsDisabled || !canMakeDefault}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Make default
        </button>
        <button
          type="button"
          onClick={() => onRemove?.(destination)}
          disabled={actionsDisabled || !canRemove}
          className="inline-flex items-center gap-2 rounded-xl border border-red-100 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Remove
        </button>
      </div>
    </article>
  );
}
