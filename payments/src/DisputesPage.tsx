import { useState, type FormEvent } from "react";
import { ShieldAlert } from "lucide-react";
import MarketHeaderBar from "./components/shared/MarketHeaderBar";
import { PAYMENTS_HUB_PATH, navigateToOrderDispute } from "./lib/appNavigation";
import { resolveOrderIdentifier } from "./lib/orderIdentifier";
import { useRequireVerifiedUser } from "./hooks/useRequireVerifiedUser";

export default function DisputesPage() {
  const ready = useRequireVerifiedUser();
  if (!ready) return null;
  return <DisputesPageContent />;
}

function DisputesPageContent() {
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = reference.trim();
    if (!value) return;

    try {
      setLoading(true);
      setError(null);
      const resolved = await resolveOrderIdentifier(value);
      navigateToOrderDispute(resolved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve the reference.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <MarketHeaderBar subtitle="Disputes" />

      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-900 text-white">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-zinc-600 sm:text-xl">Disputes</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-zinc-950 sm:text-5xl">
              Open a dispute
            </h1>
            <p className="mt-2 text-sm leading-7 text-zinc-600 sm:text-base">
              Enter the order reference, order ID, or ticket code related to the issue.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 rounded-[1.75rem] border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Enter order reference, order ID, or ticket code"
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-bold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Resolving…" : "Open dispute"}
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
