import { apiFetch } from "../../lib/api";
import type {
  PayoutDestination,
  PayoutDestinationPayload,
  PayoutPermissions,
  PayoutProviderMetadata,
  PayoutProviderOption,
  PayoutRecord,
} from "./types";

function toProviderOption(
  item: { id: string; name: string },
  destinationType: "mobile_money" | "bank",
): PayoutProviderOption {
  return {
    id: item.id,
    name: item.name,
    destinationType,
    providerRefId: item.id,
    currency: "MWK",
  };
}

export async function getPayoutPermissions(sellerUid: string): Promise<PayoutPermissions> {
  const response = await apiFetch(`/api/payouts/permissions/${encodeURIComponent(sellerUid)}`);
  return response?.permissions ?? response;
}

export async function getPayoutDestinations(sellerUid: string): Promise<PayoutDestination[]> {
  const response = await apiFetch(`/api/payouts/destinations?sellerUid=${encodeURIComponent(sellerUid)}`);
  return Array.isArray(response?.destinations) ? response.destinations : [];
}

export async function getPayoutHistory(sellerUid: string): Promise<PayoutRecord[]> {
  const response = await apiFetch(`/api/payouts/history/${encodeURIComponent(sellerUid)}`);
  return Array.isArray(response?.payouts) ? response.payouts : [];
}

export async function createPayoutDestination(payload: PayoutDestinationPayload): Promise<Record<string, unknown>> {
  const response = await apiFetch("/api/payouts/destinations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response ?? {};
}

export async function updatePayoutDestination(
  destinationId: string,
  payload: Partial<PayoutDestinationPayload>
): Promise<Record<string, unknown>> {
  const response = await apiFetch(`/api/payouts/destinations/${encodeURIComponent(destinationId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return response ?? {};
}

export async function replacePayoutDestination(
  destinationId: string,
  payload: PayoutDestinationPayload
): Promise<Record<string, unknown>> {
  const response = await apiFetch(`/api/payouts/destinations/${encodeURIComponent(destinationId)}/replace`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response ?? {};
}

export async function getPayoutProviderMetadata(): Promise<PayoutProviderMetadata> {
  const [mobileMoneyResult, bankResult] = await Promise.allSettled([
    apiFetch("/api/payouts/provider/mobile-money-operators"),
    apiFetch("/api/payouts/provider/banks?currency=MWK"),
  ]);

  const mobileMoneyOperators =
    mobileMoneyResult.status === "fulfilled" && Array.isArray(mobileMoneyResult.value?.operators)
      ? mobileMoneyResult.value.operators.map((item: { refId: string; name: string }) =>
          toProviderOption({ id: item.refId, name: item.name }, "mobile_money"),
        )
      : [];

  const banks =
    bankResult.status === "fulfilled" && Array.isArray(bankResult.value?.banks)
      ? bankResult.value.banks.map((item: { uuid: string; name: string }) =>
          toProviderOption({ id: item.uuid, name: item.name }, "bank"),
        )
      : [];

  return {
    mobileMoneyOperators,
    banks,
    currencies: ["MWK"],
  };
}

export async function deletePayoutDestination(destinationId: string): Promise<void> {
  await apiFetch(`/api/payouts/destinations/${encodeURIComponent(destinationId)}`, {
    method: "DELETE",
  });
}
