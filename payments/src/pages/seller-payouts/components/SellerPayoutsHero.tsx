import SellerEarningsSummary from "../../../components/payouts/SellerEarningsSummary";
import PayoutTimeline from "../../../components/payouts/PayoutTimeline";
import type { SellerEarningsSummary as SellerEarningsSummaryModel } from "../../../modules/payouts/summary";
import type { PayoutRecord, PayoutSummary } from "../../../modules/payouts/types";

export default function SellerPayoutsHero({
  summary,
  earningsSummary,
  payouts,
  canEditSettings,
}: {
  summary: PayoutSummary;
  earningsSummary: SellerEarningsSummaryModel;
  payouts: PayoutRecord[];
  canEditSettings: boolean;
}) {
  return (
    <section className="rounded-[28px] border border-zinc-200/80 bg-white p-6 shadow-[0_12px_30px_rgba(0,0,0,0.04)] sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-zinc-400">
            Seller payouts
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Payout control center.
          </h1>
          <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-zinc-600 sm:text-base">
            Set up your payout destination, track payout status, and keep a clean view of what is
            pending, paid, or failed.
          </p>

          <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-zinc-600">
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5">
              Active destinations: {summary.activeDestinations}
            </span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5">
              Default: {summary.defaultDestination ? summary.defaultDestination.maskedAccount : "Not set"}
            </span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5">
              Permissions: {canEditSettings ? "Edit enabled" : "View only"}
            </span>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-zinc-200 bg-zinc-50 p-3 shadow-sm lg:min-w-[520px]">
          <SellerEarningsSummary summary={earningsSummary} compact />
        </div>
      </div>

      <div className="mt-5">
        <PayoutTimeline payouts={payouts} />
      </div>
    </section>
  );
}
