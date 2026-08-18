import { useEffect, useState } from "react";
import { navigateToPath, SELLER_PAYOUTS_PATH } from "./lib/appNavigation";
import {
  clearStoredConnectContext,
  getStoredConnectContext,
  submitConnectCallback,
} from "./modules/connect/api";

const CONNECT_CONTEXT_MAX_AGE_MS = 15 * 60 * 1000;

function parseStoredConnectContext() {
  const context = getStoredConnectContext();
  if (!context) return null;

  const startedAt = new Date(context.startedAt);
  if (Number.isNaN(startedAt.getTime())) return null;

  if (Date.now() - startedAt.getTime() > CONNECT_CONTEXT_MAX_AGE_MS) {
    return null;
  }

  return context;
}

export default function ConnectCallbackPage() {
  const [message, setMessage] = useState("Connecting your PayChangu account...");

  useEffect(() => {
    const run = async () => {
      try {
        const context = parseStoredConnectContext();
        if (!context) {
          throw new Error("Connect session expired. Start again.");
        }

        const params = new URLSearchParams(window.location.search);

        await submitConnectCallback({
          sellerUid: context.sellerUid,
          connectAttemptId: context.connectAttemptId,
          accessToken: params.get("access_token") ?? undefined,
          refreshToken: params.get("refresh_token"),
          mode: params.get("mode") === "live" ? "live" : "test",
          scope: params.get("scope"),
          authorizationUrl: params.get("authorizationUrl"),
          rawPayload: Object.fromEntries(params.entries()),
        });

        clearStoredConnectContext();
        setMessage("Connected. Redirecting...");
        setTimeout(() => {
          navigateToPath(SELLER_PAYOUTS_PATH, { replace: true });
        }, 800);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Connect setup failed.");
      }
    };

    void run();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm font-medium text-zinc-700">{message}</p>
        {message !== "Connected. Redirecting..." ? (
          <button
            type="button"
            onClick={() => navigateToPath(SELLER_PAYOUTS_PATH, { replace: true })}
            className="rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50"
          >
            Back to payouts
          </button>
        ) : null}
      </div>
    </div>
  );
}
