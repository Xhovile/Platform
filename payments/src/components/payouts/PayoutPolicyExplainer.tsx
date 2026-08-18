import { Clock3, ShieldCheck } from "lucide-react";

export default function PayoutPolicyExplainer() {
  return (
    <div className="rounded-[1.75rem] border border-zinc-200 bg-white p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-400">Launch payout policy</p>
      <h3 className="mt-2 text-lg font-black tracking-tight text-zinc-900">
        Automatic queue after escrow release
      </h3>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        Released escrow funds are reviewed before payout submission. After that,
        payouts move to PayChangu and then to the seller destination.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">
          <div className="inline-flex items-center gap-2">
            <Clock3 className="h-4 w-4" />
            Sellers see clear status updates
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">
          <div className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Sensitive review details stay hidden
          </div>
        </div>
      </div>
    </div>
  );
}
