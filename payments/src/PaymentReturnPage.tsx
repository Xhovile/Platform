import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Loader2,
} from "lucide-react";
import {
  EXPLORE_PATH,
  navigateToPath,
} from "./lib/appNavigation";
import { apiFetch } from "./lib/api";
import { auth } from "./firebase";
import {
  readBuyerPayments,
  subtractBuyerCartItemQuantities,
  updateBuyerPaymentStatus,
} from "./lib/buyerState";
import { subtractEventCartItemQuantities } from "./lib/eventCart";
import { fetchOrderByReference } from "./lib/orderApi";
import { getOrderFlowType, buildTrackingTarget } from "./lib/orderFlow";

type ReturnStatus = "loading" | "success" | "failed" | "cancelled";

interface PublicStatusResponse {
  reference?: string;
  orderId?: string;
  orderStatus?: string;
  paymentStatus?: string | null;
  paymentVerified?: boolean;
  escrowStatus?: string | null;
}

interface BuyerPaymentRecord {
  status?: string;
  updatedAt?: string;
  txRef?: string | null;
  reference?: string | null;
  listingId?: string | null;
  listingIds?: string[];
  eventIds?: string[];
  checkoutItems?: Array<{ listingId?: string; eventId?: string; quantity: number }>;
  orderId?: string | null;
  paymentId?: string | null;
}

const normalizeStatus = (value: string | null | undefined) =>
  String(value ?? "").trim().toLowerCase();

const getPurchasedItems = (
  payment: BuyerPaymentRecord | null,
): Array<{ listingId?: string; eventId?: string; quantity: number }> => {
  if (!payment) return [];
  if (payment.checkoutItems?.length) {
    return payment.checkoutItems
      .map((item) => ({
        listingId: item.listingId ? String(item.listingId) : undefined,
        eventId: item.eventId ? String(item.eventId) : undefined,
        quantity: Math.max(0, Math.floor(Number(item.quantity))),
      }))
      .filter((item) => (item.listingId || item.eventId) && item.quantity > 0);
  }

  if (payment.listingIds?.length && payment.listingIds[0]) {
    return [{ listingId: String(payment.listingIds[0]), quantity: 1 }];
  }

  if (payment.eventIds?.length && payment.eventIds[0]) {
    return [{ eventId: String(payment.eventIds[0]), quantity: 1 }];
  }

  return payment.listingId ? [{ listingId: String(payment.listingId), quantity: 1 }] : [];
};

export default function PaymentReturnPage() {
  const [status, setStatus] = useState<ReturnStatus>("loading");
  const [reference, setReference] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const txRefFromUrl =
      params.get("tx_ref") ?? params.get("txRef") ?? params.get("reference");
    const cancelled = params.get("cancelled");
    const paymentStatusFromUrl = normalizeStatus(
      params.get("payment_status") ?? params.get("paymentStatus") ?? params.get("status"),
    );

    if (
      cancelled === "1" ||
      paymentStatusFromUrl === "cancelled" ||
      paymentStatusFromUrl === "canceled"
    ) {
      setStatus("cancelled");
      return;
    }

    const rawPayments = readBuyerPayments();
    const buyerPayments = Array.isArray(rawPayments)
      ? (rawPayments as BuyerPaymentRecord[])
      : [];

    const latestPendingPayment = buyerPayments
      .filter((payment) => payment.status === "pending")
      .sort(
        (a, b) =>
          new Date(b.updatedAt ?? 0).getTime() -
          new Date(a.updatedAt ?? 0).getTime(),
      )[0] ?? null;

    const txRef = txRefFromUrl?.trim() || null;

    if (!txRef) {
      if (latestPendingPayment?.txRef || latestPendingPayment?.reference) {
        updateBuyerPaymentStatus(
          String(latestPendingPayment.txRef ?? latestPendingPayment.reference),
          {
            status: "cancelled",
            txRef: String(latestPendingPayment.txRef ?? latestPendingPayment.reference),
          },
        );
      }

      setStatus("failed");
      setErrorMessage(
        "No completed payment was detected for this session. You can go back to the app and try again.",
      );
      return;
    }

    setReference(txRef);

    let mounted = true;
    let attempts = 0;
    let timer: number | null = null;

    const pollStatus = async () => {
      try {
        const result = (await apiFetch(
          `/api/payments/public-status/${encodeURIComponent(txRef)}`,
        )) as PublicStatusResponse;

        if (!mounted) return;

        const paymentVerified = Boolean(result.paymentVerified);
        const orderStatus = normalizeStatus(result.orderStatus);
        const paymentStatus = normalizeStatus(result.paymentStatus);

        const isSuccessful =
          paymentVerified ||
          paymentStatus === "captured" ||
          paymentStatus === "paid" ||
          orderStatus === "paid" ||
          orderStatus === "processing";

        if (isSuccessful) {
          const matchedPayment =
            buyerPayments.find(
              (payment) => payment.txRef === txRef || payment.reference === txRef,
            ) ?? latestPendingPayment;

          const currentUid = auth.currentUser?.uid ?? null;
          if (matchedPayment) {
            const purchasedItems = getPurchasedItems(matchedPayment);
            const listingPurchases = purchasedItems
              .filter((item): item is { listingId: string; quantity: number } => !!item.listingId)
              .map((item) => ({ listingId: item.listingId, quantity: item.quantity }));
            const eventPurchases = purchasedItems
              .filter((item): item is { eventId: string; quantity: number } => !!item.eventId)
              .map((item) => ({ eventId: item.eventId, quantity: item.quantity }));

            updateBuyerPaymentStatus(matchedPayment.reference || txRef, {
              status: "captured",
              txRef,
              orderId: result.orderId ?? matchedPayment.orderId ?? null,
              paymentId: matchedPayment.paymentId,
            });

            if (listingPurchases.length) {
              await subtractBuyerCartItemQuantities(listingPurchases);
            }
            if (currentUid && eventPurchases.length) {
              await subtractEventCartItemQuantities(currentUid, eventPurchases);
            }
          }

          let flowType = "unknown";
          try {
            const bundle = await fetchOrderByReference(txRef);
            flowType = getOrderFlowType(bundle as never);
          } catch {
            flowType = "unknown";
          }

          const target = buildTrackingTarget(txRef, flowType as never);
          setOrderId(result.orderId ?? null);
          setStatus("success");

          timer = window.setTimeout(() => {
            navigateToPath(target.destinationPath, {
              replace: true,
            });
          }, 1200);

          return;
        }

        const isFailed =
          paymentStatus === "failed" ||
          paymentStatus === "cancelled" ||
          paymentStatus === "canceled" ||
          paymentStatus === "expired" ||
          orderStatus === "failed" ||
          orderStatus === "cancelled" ||
          orderStatus === "canceled";

        if (isFailed) {
          setErrorMessage(`Payment status: ${paymentStatus || orderStatus}`);
          setStatus("failed");
          return;
        }

        attempts += 1;

        if (attempts >= 8) {
          setErrorMessage(
            "We could not confirm a completed payment for this session. Your order was not marked as paid.",
          );
          setStatus("failed");
          return;
        }

        timer = window.setTimeout(pollStatus, 2000);
      } catch (err: unknown) {
        if (!mounted) return;

        attempts += 1;

        if (attempts >= 8) {
          setErrorMessage(
            err instanceof Error ? err.message : "Failed to recover payment status.",
          );
          setStatus("failed");
          return;
        }

        timer = window.setTimeout(pollStatus, 2000);
      }
    };

    void pollStatus();

    return () => {
      mounted = false;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-white text-zinc-900">
      <div className="w-full px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-zinc-500" />
            <h1 className="text-xl font-extrabold text-zinc-900">Finalizing payment…</h1>
            <p className="text-sm text-zinc-500">
              We are confirming your order
            </p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="h-16 w-16 text-emerald-500" />
            <h1 className="text-2xl font-black text-zinc-900">Payment received!</h1>
            <p className="text-sm leading-6 text-zinc-600">
              Your payment was received successfully. Opening your tracking page.
            </p>

            {reference && (
              <p className="rounded-xl bg-zinc-50 px-4 py-2 text-xs font-mono text-zinc-400">
                Ref: {reference}
              </p>
            )}

            {orderId && (
              <p className="text-xs text-zinc-400">Order: {orderId}</p>
            )}
          </div>
        )}

        {status === "failed" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="h-16 w-16 text-amber-500" />
            <h1 className="text-2xl font-black text-zinc-900">Payment not completed</h1>
            <p className="max-w-xl text-sm leading-6 text-zinc-600">
              {errorMessage || "We could not confirm your payment."}
            </p>
            <button
              type="button"
              onClick={() => navigateToPath(EXPLORE_PATH)}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to market
            </button>
          </div>
        )}

        {status === "cancelled" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="h-16 w-16 text-zinc-400" />
            <h1 className="text-2xl font-black text-zinc-900">Payment cancelled</h1>
            <p className="max-w-xl text-sm leading-6 text-zinc-600">
              You cancelled the checkout before it completed.
            </p>
            <button
              type="button"
              onClick={() => navigateToPath(EXPLORE_PATH)}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to market
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
