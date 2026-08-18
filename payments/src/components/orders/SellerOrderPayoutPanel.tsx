import { BadgeCheck, CalendarClock, Landmark, ShieldAlert, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import type { SellerOrderPayoutViewModel } from "../../modules/payouts/orderPayoutViewModel";

type SellerOrderPayoutPanelProps = {
  model: SellerOrderPayoutViewModel;
};

function Item({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-zinc-900">
        {icon}
        {value}
      </p>
    </div>
  );
}

export default function SellerOrderPayoutPanel({ model }: SellerOrderPayoutPanelProps) {
  return (
    <div className="rounded-[2rem] border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-900 text-white">
          <Wallet className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Seller payout</p>
          <h3 className="mt-1 text-lg font-black text-zinc-950">{model.payoutStatusLabel}</h3>
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-600">{model.payoutStatusDetail}</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Item icon={<BadgeCheck className="h-4 w-4" />} label="Payment captured" value={model.paymentCapturedLabel} />
        <Item icon={<Landmark className="h-4 w-4" />} label="Release eligibility" value={model.releaseEligibilityLabel} />
        <Item icon={<CalendarClock className="h-4 w-4" />} label="Estimated payout" value={model.estimatedPayoutDate} />
        <Item icon={<Wallet className="h-4 w-4" />} label="Destination" value={model.payoutDestinationMask} />
      </div>

      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex items-center gap-2 font-black">
          <ShieldAlert className="h-4 w-4" />
          Next step
        </div>
        <p className="mt-2 leading-6">{model.nextStepGuidance}</p>
      </div>
    </div>
  );
}
