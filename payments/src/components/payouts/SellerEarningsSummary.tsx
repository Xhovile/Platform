import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Clock3,
  Landmark,
  ShieldAlert,
  type LucideIcon,
  Wallet,
} from "lucide-react";
import {
  formatSellerEarningsAmount,
  type SellerEarningsBucketKey,
  type SellerEarningsSummary as SellerEarningsSummaryModel,
} from "../../modules/payouts/summary";

type SellerEarningsSummaryProps = {
  summary: SellerEarningsSummaryModel;
  className?: string;
  compact?: boolean;
};

type SummaryCard = {
  key: SellerEarningsBucketKey;
  label: string;
  helper: string;
  tone: string;
  icon: LucideIcon;
};

type SummaryNotice = {
  tone: "red" | "amber" | "emerald";
  title: string;
  message: string;
  icon: LucideIcon;
};

const CARDS: SummaryCard[] = [
  {
    key: "lifetimeSales",
    label: "Lifetime sales",
    helper: "Seller revenue tracked from escrow and payouts",
    tone: "bg-indigo-50 text-indigo-700 border-indigo-100",
    icon: Wallet,
  },
  {
    key: "inEscrow",
    label: "In escrow",
    helper: "Paid orders still protected before release",
    tone: "bg-sky-50 text-sky-700 border-sky-100",
    icon: Landmark,
  },
  {
    key: "availableForPayout",
    label: "Available for payout",
    helper: "Released funds after BuyMesho commission; PayChangu payout fees may still apply",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-100",
    icon: Banknote,
  },
  {
    key: "pendingPayout",
    label: "Pending payout",
    helper: "Net amount sent to PayChangu; transfer fees may be deducted by payout method",
    tone: "bg-amber-50 text-amber-700 border-amber-100",
    icon: Clock3,
  },
  {
    key: "paidOut",
    label: "Paid out",
    helper: "Completed provider payouts",
    tone: "bg-green-50 text-green-700 border-green-100",
    icon: BadgeCheck,
  },
  {
    key: "failedActionRequired",
    label: "Failed payout - action required",
    helper: "Failed payouts needing review or retry",
    tone: "bg-red-50 text-red-700 border-red-100",
    icon: AlertTriangle,
  },
];

function getSummaryNotice(summary: SellerEarningsSummaryModel): SummaryNotice | null {
  if (summary.hasFailedPayout) {
    return {
      tone: "red",
      title: "Failed payout needs action",
      message:
        "One or more payouts failed. Review your payout destination or retry after admin guidance.",
      icon: AlertTriangle,
    };
  }

  if (summary.hasHeldPayout) {
    return {
      tone: "amber",
      title: "Payout held for review",
      message:
        "One or more payouts are currently held while they are reviewed.",
      icon: ShieldAlert,
    };
  }

  if (summary.hasMissingDestination) {
    return {
      tone: "emerald",
      title: "Add a payout destination",
      message:
        "Set a default mobile money or bank destination so released funds can be paid out.",
      icon: Wallet,
    };
  }

  if (summary.hasUnverifiedDestination) {
    return {
      tone: "amber",
      title: "Payout destination not verified",
      message:
        "Your active payout destination must be verified before available funds can move out.",
      icon: ShieldAlert,
    };
  }

  return null;
}

export default function SellerEarningsSummary({
  summary,
  className = "",
  compact = false,
}: SellerEarningsSummaryProps) {
  const notice = getSummaryNotice(summary);

  return (
    <div className={className}>
      <div
        className={`grid gap-3 ${compact ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"}`}
      >
        {CARDS.map((card) => (
          <SellerEarningsSummaryCard
            key={card.key}
            card={card}
            value={summary[card.key]}
            currency={summary.currency}
            compact={compact}
          />
        ))}
      </div>

      {notice ? (
        <div
          className={`mt-4 flex items-start gap-3 rounded-[1.5rem] border p-4 ${
            notice.tone === "red"
              ? "border-red-200 bg-red-50 text-red-900"
              : notice.tone === "amber"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80">
            <notice.icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-black">{notice.title}</p>
            <p className="mt-1 text-xs font-semibold leading-5 opacity-85 sm:text-sm">
              {notice.message}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SellerEarningsSummaryCard({
  card,
  value,
  currency,
  compact,
}: {
  card: SummaryCard;
  value: number;
  currency: string;
  compact: boolean;
}) {
  const Icon = card.icon;

  return (
    <div
      className={`rounded-2xl border border-zinc-200 bg-white ${compact ? "p-3" : "p-4"} shadow-sm`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">
            {card.label}
          </p>
          <p
            className={`${compact ? "text-base" : "text-xl"} mt-1 whitespace-nowrap font-black tabular-nums tracking-tight text-zinc-900`}
            aria-label={`${card.label}: ${formatSellerEarningsAmount(value, currency)}`}
          >
            {formatSellerEarningsAmount(value, currency)}
          </p>
        </div>
        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${card.tone}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-[11px] font-semibold leading-4 text-zinc-500">
        {card.helper}
      </p>
    </div>
  );
}
