import { ArrowLeft, Loader2, Store, ShieldCheck } from "lucide-react";

export default function SellerPayoutsAccessGate({
  loading,
  isSeller,
  onBack,
}: {
  loading: boolean;
  isSeller: boolean;
  onBack: () => void;
}) {
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8] px-4">
        <div className="flex items-center gap-3 rounded-3xl border border-zinc-200 bg-white px-5 py-4 shadow-[0_12px_35px_rgba(0,0,0,0.06)]">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-700" />
          <span className="font-bold text-zinc-700">Loading seller workspace…</span>
        </div>
      </div>
    );
  }

  if (isSeller) return null;

  return (
    <div className="min-h-screen bg-[#f5f6f8] px-4 py-8 text-zinc-900 sm:py-12">
      <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
        <div className="w-full rounded-[32px] border border-zinc-200 bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.07)] sm:p-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-white">
            <Store className="h-7 w-7" />
          </div>

          <p className="mt-6 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">Seller workspace</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Seller access required</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-600">
            This workspace is available to approved sellers. Once your seller account is active, your
            Orders, Payouts and Settings will appear here.
          </p>

          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-zinc-600" />
            <p className="text-sm leading-5 text-zinc-600">Your seller access is checked from your BuyMesho account profile.</p>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-5 py-3.5 text-sm font-extrabold text-white transition-colors hover:bg-zinc-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Seller Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
