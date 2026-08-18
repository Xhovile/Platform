import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, FileText, MessageSquare, ShieldAlert } from "lucide-react";
import { navigateBackOrPath, PAYMENTS_HUB_PATH } from "./lib/appNavigation";
import { fetchOrderById, openOrderDispute, type OrderBundle } from "./lib/orderApi";
import { resolveOrderIdentifier } from "./lib/orderIdentifier";
import FormDropdown from "./components/FormDropdown";

const DISPUTE_REASONS = [
  { value: "not_received", label: "Item not received" },
  { value: "not_as_described", label: "Item not as described" },
  { value: "wrong_item", label: "Wrong item sent" },
  { value: "damaged", label: "Item arrived damaged" },
  { value: "payment_issue", label: "Payment not confirmed" },
  { value: "other", label: "Other" },
] as const;

export default function OrderDisputePage() {
  const [bundle, setBundle] = useState<OrderBundle | null>(null);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const orderParam = useMemo(() => {
    const parts = window.location.pathname.split("/");
    const disputeIndex = parts.indexOf("dispute");
    return disputeIndex > 0 ? decodeURIComponent(parts[disputeIndex - 1]) : null;
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const resolved = await resolveOrderIdentifier(orderParam ?? "");
        const data = await fetchOrderById(resolved);
        setBundle(data);
      } catch (err) {
        setBundle(null);
        setError(err instanceof Error ? err.message : "Failed to load order.");
      } finally {
        setLoading(false);
      }
    };

    if (orderParam) {
      void load();
    } else {
      setLoading(false);
      setError("Missing order identifier in URL.");
    }
  }, [orderParam]);

  const order = bundle?.order ?? null;
  const paymentReference = typeof order?.paymentReference === "string" ? order.paymentReference : orderParam;
  const totalAmount = Number(order?.total?.amount ?? 0);
  const totalCurrency = String(order?.total?.currency ?? "MWK");
  const itemTitle = order?.items?.[0]?.title ?? "—";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || !order) return;

    try {
      setError(null);
      await openOrderDispute(order.id, [reason.trim(), details.trim()].filter(Boolean).join(" — "));
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit dispute.");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigateBackOrPath(PAYMENTS_HUB_PATH)}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>

        <section className="mt-6 rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-900 text-white">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Order dispute</p>
              <h1 className="text-3xl font-black tracking-tight text-zinc-950">Report a problem</h1>
            </div>
          </div>

          {loading ? (
            <div className="mt-6 rounded-[2rem] border border-zinc-200 bg-zinc-50 p-6 text-sm leading-6 text-zinc-600">
              Loading order details…
            </div>
          ) : error ? (
            <div className="mt-6 rounded-[2rem] border border-red-200 bg-red-50 p-6 text-sm leading-6 text-red-700">
              {error}
            </div>
          ) : order ? (
            <div className="mt-6 rounded-[2rem] border border-zinc-200 bg-zinc-50 p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-zinc-500" />
                <h2 className="text-base font-black text-zinc-950">Order details</h2>
              </div>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
                  <span className="text-zinc-500">Reference</span>
                  <p className="mt-1 break-all font-semibold text-zinc-900">{paymentReference}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
                  <span className="text-zinc-500">Item</span>
                  <p className="mt-1 font-semibold text-zinc-900">{itemTitle}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
                  <span className="text-zinc-500">Status</span>
                  <p className="mt-1 font-semibold text-zinc-900">{order.status}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
                  <span className="text-zinc-500">Total</span>
                  <p className="mt-1 font-semibold text-zinc-900">{totalCurrency} {totalAmount.toLocaleString()}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-[2rem] border border-zinc-200 bg-zinc-50 p-6 text-sm leading-6 text-zinc-600">
              No matching order found for this dispute link. If you arrived here from a notification, the order may have expired.
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-zinc-500" />
              <h2 className="text-base font-black text-zinc-950">Submit a dispute</h2>
            </div>

            {submitted ? (
              <div className="mt-4 rounded-[2rem] border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-900">
                <div className="flex items-center gap-2 font-black">
                  <ShieldAlert className="h-4 w-4" />
                  Dispute received
                </div>
                <p className="mt-2 leading-6">
                  Your dispute has been recorded. Our team will review it and follow up via your registered contact details.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                <FormDropdown
                  label="Reason for dispute"
                  value={reason}
                  onChange={setReason}
                  placeholder="Select a reason"
                  options={DISPUTE_REASONS}
                  searchable={false}
                  disabled={!order || loading}
                />

                <div>
                  <label htmlFor="dispute-details" className="block text-sm font-bold text-zinc-700">
                    Additional details
                  </label>
                  <textarea
                    id="dispute-details"
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    rows={4}
                    placeholder="Describe the issue in as much detail as possible..."
                    className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>

                <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="flex items-center gap-2 font-black">
                    <AlertTriangle className="h-4 w-4" />
                    Before you submit
                  </div>
                  <p className="mt-2 leading-6">Only raise a dispute if you have a genuine issue with your order. False disputes may result in account restrictions.</p>
                </div>

                <button
                  type="submit"
                  disabled={!order || !reason.trim() || loading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ShieldAlert className="h-4 w-4" />
                  Submit dispute
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
