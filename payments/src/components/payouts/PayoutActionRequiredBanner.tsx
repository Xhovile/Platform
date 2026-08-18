import {
  AlertTriangle,
  type LucideIcon,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import type { PayoutDestination } from "../../modules/payouts/types";
import type { SellerEarningsSummary } from "../../modules/payouts/summary";

type PayoutActionRequiredBannerProps = {
  summary?: SellerEarningsSummary | null;
  destinations?: Array<
    Pick<PayoutDestination, "isActive" | "verificationStatus"> & {
      maskedAccount?: string | null;
    }
  > | null;
  onAction?: () => void;
  actionLabel?: string;
  className?: string;
};

type BannerContent = {
  tone: "red" | "amber" | "emerald";
  title: string;
  message: string;
  actionLabel: string;
  icon: LucideIcon;
};

function destinationWarning(
  destinations?: PayoutActionRequiredBannerProps["destinations"],
): BannerContent | null {
  if (!destinations) return null;

  const activeDestinations = destinations.filter(
    (destination) => destination.isActive !== false,
  );
  const failedDestination = activeDestinations.find(
    (destination) =>
      String(destination.verificationStatus ?? "").toLowerCase() === "failed",
  );
  const pendingDestination = activeDestinations.find(
    (destination) =>
      String(destination.verificationStatus ?? "").toLowerCase() === "pending",
  );
  const verifiedDestination = activeDestinations.find(
    (destination) =>
      String(destination.verificationStatus ?? "").toLowerCase() === "verified",
  );

  if (failedDestination) {
    return {
      tone: "red",
      title: "Payout destination needs attention",
      message:
        "Your payout destination failed verification. Update it so eligible releases can be paid out.",
      actionLabel: "Fix payout settings",
      icon: AlertTriangle,
    };
  }

  if (pendingDestination) {
    return {
      tone: "amber",
      title: "Payout verification is pending",
      message: `We are verifying ${pendingDestination.maskedAccount || "your payout destination"}. Check your payout settings for status updates.`,
      actionLabel: "Review payout settings",
      icon: ShieldAlert,
    };
  }

  if (!verifiedDestination) {
    return {
      tone: "emerald",
      title: "Set up payouts before your next sale",
      message:
        "Add an active payout destination so released escrow funds can move to your mobile money or bank account.",
      actionLabel: "Set up payouts",
      icon: Wallet,
    };
  }

  return null;
}

function summaryWarning(
  summary?: SellerEarningsSummary | null,
): BannerContent | null {
  if (!summary) return null;

  if (summary.hasFailedPayout) {
    return {
      tone: "red",
      title: "Failed payout needs action",
      message:
        "A payout could not be completed. Review your payout destination or wait for admin retry guidance.",
      actionLabel: "Review payouts",
      icon: AlertTriangle,
    };
  }

  if (summary.hasHeldPayout) {
    return {
      tone: "amber",
      title: "Payout held for review",
      message:
        "One or more payouts are held while the admin team reviews the release.",
      actionLabel: "View payout status",
      icon: ShieldAlert,
    };
  }

  if (summary.hasMissingDestination) {
    return {
      tone: "emerald",
      title: "Add a payout destination",
      message:
        "Set a default mobile money or bank destination before released funds can be paid out.",
      actionLabel: "Set up payouts",
      icon: Wallet,
    };
  }

  if (summary.hasUnverifiedDestination) {
    return {
      tone: "amber",
      title: "Payout destination not verified",
      message:
        "Your active payout destination must be verified before available funds can move out.",
      actionLabel: "Review destination",
      icon: ShieldAlert,
    };
  }

  return null;
}

export default function PayoutActionRequiredBanner({
  summary,
  destinations,
  onAction,
  actionLabel,
  className = "",
}: PayoutActionRequiredBannerProps) {
  const content = summaryWarning(summary) ?? destinationWarning(destinations);
  if (!content) return null;

  const Icon = content.icon;
  const toneClass =
    content.tone === "red"
      ? "border-red-200 bg-red-50 text-red-900"
      : content.tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div
      className={`rounded-[1.5rem] border p-4 sm:flex sm:items-center sm:justify-between sm:gap-4 ${toneClass} ${className}`}
    >
      <div className="flex gap-3">
        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/75">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-black">{content.title}</p>
          <p className="mt-1 text-xs font-semibold opacity-80 sm:text-sm">
            {content.message}
          </p>
        </div>
      </div>

      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-zinc-800 sm:mt-0 sm:w-auto"
        >
          {actionLabel || content.actionLabel}
          <Wallet className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
