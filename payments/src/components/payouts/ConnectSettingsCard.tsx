import { Building2, Loader2, RefreshCw } from "lucide-react";
import type { PayChanguConnectAccount, PayChanguConnectMode } from "../../modules/connect/api";

function ConnectStatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-400">{label}</p>
      <p className="mt-2 text-lg font-black text-zinc-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-600">{detail}</p>
    </div>
  );
}

function getConnectStatusLabel(status?: PayChanguConnectAccount["status"] | null) {
  switch (status) {
    case "connected":
      return "Connected";
    case "revoked":
      return "Disconnected";
    case "error":
      return "Error";
    case "pending":
      return "Pending";
    default:
      return "Not connected";
  }
}

function getConnectStatusDetail(status?: PayChanguConnectAccount["status"] | null) {
  if (status === "connected") {
    return "PayChangu Connect is ready for direct seller settlement.";
  }
  return "Set up Connect to enable direct settlement for connect-route orders.";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ConnectSettingsCard({
  connectAccount,
  connectLoading,
  connectError,
  connectDefaultMode,
  defaultConnectScope,
  onRefresh,
  onConnect,
  onDisconnect,
}: {
  connectAccount: PayChanguConnectAccount | null;
  connectLoading: boolean;
  connectError: string | null;
  connectDefaultMode: PayChanguConnectMode;
  defaultConnectScope: string;
  onRefresh: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connectStatus = connectAccount?.status ?? null;

  return (
    <section className="rounded-[28px] border border-zinc-200/80 bg-white p-6 shadow-[0_12px_30px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-zinc-400">
                PayChangu Connect
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-tight">Direct settlement setup.</h2>
            </div>
            <Building2 className="h-5 w-5 text-zinc-400" />
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            Connect your PayChangu account here so connect settlement orders can pay directly to
            your linked PayChangu account. Your payout destinations below still handle the standard
            seller payout flow.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={connectLoading}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {connectLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh status
          </button>

          <button
            type="button"
            onClick={onConnect}
            disabled={connectLoading}
            className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {connectLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {connectAccount?.status === "connected" ? "Reconnect PayChangu" : "Connect PayChangu"}
          </button>

          {connectAccount?.status === "connected" ? (
            <button
              type="button"
              onClick={onDisconnect}
              disabled={connectLoading}
              className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Revoke access token
            </button>
          ) : null}
        </div>
      </div>

      {connectError ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {connectError}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ConnectStatCard
          label="Connection status"
          value={getConnectStatusLabel(connectStatus)}
          detail={getConnectStatusDetail(connectStatus)}
        />
        <ConnectStatCard
          label="Connected user"
          value={connectAccount?.connectUserName || connectAccount?.connectUserEmail || "—"}
          detail={connectAccount?.connectUserEmail || "No PayChangu profile linked yet."}
        />
        <ConnectStatCard
          label="Mode"
          value={connectAccount?.mode || connectDefaultMode}
          detail={connectAccount?.scope || defaultConnectScope}
        />
        <ConnectStatCard
          label="Last update"
          value={formatDate(connectAccount?.connectedAt || connectAccount?.revokedAt || null)}
          detail={connectAccount?.lastError || "Connection details are stored on the seller account."}
        />
      </div>
    </section>
  );
}
