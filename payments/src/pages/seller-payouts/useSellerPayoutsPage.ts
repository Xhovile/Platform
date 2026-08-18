import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { fetchSellerEscrows } from "../../lib/orderApi";
import { getSellerCache, setSellerCache } from "../../lib/sellerWorkspaceCache";
import {
  createConnectAuthorizationLink,
  disconnectConnectAccount,
  getConnectAccount,
  type PayChanguConnectAccount,
  type PayChanguConnectMode,
} from "../../modules/connect/api";
import {
  createPayoutDestination,
  deletePayoutDestination,
  getPayoutDestinations,
  getPayoutHistory,
  getPayoutPermissions,
  getPayoutProviderMetadata,
  replacePayoutDestination,
  updatePayoutDestination,
} from "../../modules/payouts/api";
import {
  buildSellerEarningsSummary,
  type EscrowSummaryRecord,
} from "../../modules/payouts/summary";
import type {
  PayoutDestination,
  PayoutDestinationFormState,
  PayoutPermissions,
  PayoutProviderMetadata,
  PayoutRecord,
  PayoutSummary,
} from "../../modules/payouts/types";
import {
  buildDestinationPayload,
  buildDestinationQueueDiagnostic,
  DEFAULT_CONNECT_SCOPE,
  DEFAULT_CURRENCY,
  INITIAL_PAYOUT_DESTINATION_FORM,
  REFRESH_INTERVAL_MS,
  REMOVE_COUNTDOWN_SECONDS,
  toEscrowSummaryRecord,
  validateDestinationForm,
  type DestinationQueueDiagnostic,
} from "./sellerPayouts.helpers";

const CONNECT_DEFAULT_MODE: PayChanguConnectMode =
  import.meta.env.VITE_PAYCHANGU_MODE === "live" ? "live" : "test";

type SellerPayoutCache = {
  permissions: PayoutPermissions | null;
  destinations: PayoutDestination[];
  payouts: PayoutRecord[];
  escrows: EscrowSummaryRecord[];
  providerMetadata: PayoutProviderMetadata;
  connectAccount: PayChanguConnectAccount | null;
};

function payoutCacheKey(sellerId: string) {
  return `payouts:${sellerId}`;
}

export function useSellerPayoutsPage() {
  const { firebaseUser, profile, profileLoading } = useAccountProfile();

  const [permissions, setPermissions] = useState<PayoutPermissions | null>(null);
  const [destinations, setDestinations] = useState<PayoutDestination[]>([]);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [escrows, setEscrows] = useState<EscrowSummaryRecord[]>([]);
  const [providerMetadata, setProviderMetadata] = useState<PayoutProviderMetadata>({
    mobileMoneyOperators: [],
    banks: [],
    currencies: [DEFAULT_CURRENCY],
  });

  const [connectAccount, setConnectAccount] = useState<PayChanguConnectAccount | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);
  const [form, setForm] = useState<PayoutDestinationFormState>(INITIAL_PAYOUT_DESTINATION_FORM);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingDestination, setSavingDestination] = useState(false);
  const [destinationFormError, setDestinationFormError] = useState<string | null>(null);
  const [lastSaveDiagnostic, setLastSaveDiagnostic] = useState<DestinationQueueDiagnostic | null>(null);

  const [notice, setNotice] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const [removeTarget, setRemoveTarget] = useState<PayoutDestination | null>(null);
  const [removeCountdown, setRemoveCountdown] = useState(REMOVE_COUNTDOWN_SECONDS);

  const sellerId = firebaseUser?.uid || profile?.uid || "";
  const isSeller = Boolean(profile?.is_seller);
  const cacheKey = sellerId ? payoutCacheKey(sellerId) : "";

  const hydrateCache = useCallback(() => {
    if (!cacheKey) return false;
    const cached = getSellerCache<SellerPayoutCache>(cacheKey);
    if (!cached) return false;
    setPermissions(cached.permissions);
    setDestinations(cached.destinations);
    setPayouts(cached.payouts);
    setEscrows(cached.escrows);
    setProviderMetadata(cached.providerMetadata);
    setConnectAccount(cached.connectAccount);
    setLoading(false);
    return true;
  }, [cacheKey]);

  const loadData = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!sellerId) return;
      if (!options?.silent) setLoading(true);

      try {
        const [permissionsRes, destinationsRes, payoutsRes, escrowsRes, providerMetadataRes, connectRes] = await Promise.allSettled([
          getPayoutPermissions(sellerId),
          getPayoutDestinations(sellerId),
          getPayoutHistory(sellerId),
          fetchSellerEscrows(),
          getPayoutProviderMetadata(),
          getConnectAccount(sellerId),
        ]);

        const nextPermissions = permissionsRes.status === "fulfilled" ? permissionsRes.value : null;
        const nextDestinations = destinationsRes.status === "fulfilled" ? destinationsRes.value : [];
        const nextPayouts = payoutsRes.status === "fulfilled" ? payoutsRes.value : [];
        const nextProviderMetadata = providerMetadataRes.status === "fulfilled"
          ? providerMetadataRes.value
          : { mobileMoneyOperators: [], banks: [], currencies: [DEFAULT_CURRENCY] };
        const nextConnectAccount = connectRes.status === "fulfilled" ? connectRes.value : null;
        const nextEscrows = escrowsRes.status === "fulfilled"
          ? escrowsRes.value
              .map((entry) => toEscrowSummaryRecord(entry))
              .filter((entry): entry is NonNullable<ReturnType<typeof toEscrowSummaryRecord>> => entry !== null)
          : [];

        setPermissions(nextPermissions);
        setDestinations(nextDestinations);
        setPayouts(nextPayouts);
        setProviderMetadata(nextProviderMetadata);
        setConnectAccount(nextConnectAccount);
        setEscrows(nextEscrows);

        if (cacheKey) {
          setSellerCache<SellerPayoutCache>(cacheKey, {
            permissions: nextPermissions,
            destinations: nextDestinations,
            payouts: nextPayouts,
            escrows: nextEscrows,
            providerMetadata: nextProviderMetadata,
            connectAccount: nextConnectAccount,
          });
        }
      } catch (error) {
        setNotice({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to load payout data",
        });
      } finally {
        if (!options?.silent) setLoading(false);
        setRefreshing(false);
      }
    },
    [cacheKey, sellerId],
  );

  useEffect(() => {
    if (!sellerId) return;
    const hasCache = hydrateCache();
    void loadData({ silent: hasCache });
  }, [hydrateCache, loadData, sellerId]);

  useEffect(() => {
    if (!sellerId) return;

    const refreshData = () => {
      if (document.visibilityState !== "visible") return;
      void loadData({ silent: true });
    };

    window.addEventListener("focus", refreshData);
    document.addEventListener("visibilitychange", refreshData);
    const interval = window.setInterval(refreshData, REFRESH_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", refreshData);
      document.removeEventListener("visibilitychange", refreshData);
      window.clearInterval(interval);
    };
  }, [sellerId, loadData]);

  useEffect(() => {
    if (!removeTarget) return;

    setRemoveCountdown(REMOVE_COUNTDOWN_SECONDS);
    const interval = window.setInterval(() => {
      setRemoveCountdown((prev) => {
        if (prev <= 0) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [removeTarget]);

  const earningsSummary = useMemo(() => buildSellerEarningsSummary({ payouts, escrows, destinations }), [payouts, escrows, destinations]);
  const activeDestinations = useMemo(() => destinations.filter((item) => item.isActive), [destinations]);
  const summary = useMemo<PayoutSummary>(() => ({
    activeDestinations: activeDestinations.length,
    defaultDestination: activeDestinations.find((item) => item.isDefault) || null,
    total: earningsSummary.lifetimeSales,
    paid: earningsSummary.paidOut,
    pending: earningsSummary.availableForPayout + earningsSummary.pendingPayout,
    failed: earningsSummary.failedActionRequired,
  }), [activeDestinations, earningsSummary]);

  const canEditSettings = permissions?.editPayoutSettings !== false;
  const canViewHistory = permissions?.viewPayoutHistory !== false;

  const startEdit = useCallback((destination: PayoutDestination) => {
    setDestinationFormError(null);
    setSelectedDestinationId(destination.id);
    setForm({
      destinationType: destination.destinationType,
      providerName: destination.providerName,
      providerRefId: destination.providerRefId || "",
      currency: destination.currency || DEFAULT_CURRENCY,
      accountName: destination.accountName,
      accountNumber: "",
      mobile: "",
      isDefault: destination.isDefault,
    });
  }, []);

  const resetForm = useCallback(() => {
    setSelectedDestinationId(null);
    setDestinationFormError(null);
    setForm(INITIAL_PAYOUT_DESTINATION_FORM);
  }, []);

  const handleConnectRefresh = useCallback(async () => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      await loadData({ silent: true });
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Failed to refresh Connect status.");
    } finally {
      setConnectLoading(false);
    }
  }, [loadData]);

  const handleConnect = useCallback(async () => {
    if (!sellerId) return;
    try {
      setConnectLoading(true);
      setConnectError(null);
      const result = await createConnectAuthorizationLink({
        sellerUid: sellerId,
        clientId: import.meta.env.VITE_PAYCHANGU_CLIENT_ID,
        redirectUri: `${window.location.origin}/connect/callback`,
        mode: CONNECT_DEFAULT_MODE,
        scope: DEFAULT_CONNECT_SCOPE,
        whUrl: import.meta.env.VITE_PAYCHANGU_WEBHOOK_URL,
        whSecret: import.meta.env.VITE_PAYCHANGU_WEBHOOK_SECRET,
      });
      window.location.href = result.authorizationUrl;
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Failed to start Connect onboarding.");
    } finally {
      setConnectLoading(false);
    }
  }, [sellerId]);

  const handleDisconnect = useCallback(async () => {
    if (!sellerId) return;
    try {
      setConnectLoading(true);
      setConnectError(null);
      const updated = await disconnectConnectAccount(sellerId, "Seller disconnected from PayChangu Connect");
      setConnectAccount(updated);
      setLastSaveDiagnostic(null);
      await loadData({ silent: true });
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Failed to disconnect Connect.");
    } finally {
      setConnectLoading(false);
    }
  }, [loadData, sellerId]);

  const handleSaveDestination = useCallback(async () => {
    if (!sellerId) return;
    const validationMessage = validateDestinationForm(form);
    if (validationMessage) {
      setDestinationFormError(validationMessage);
      setNotice({ type: "info", message: validationMessage });
      setLastSaveDiagnostic(null);
      return;
    }

    setDestinationFormError(null);
    setSavingDestination(true);
    try {
      const payload = buildDestinationPayload(sellerId, form);
      const response = selectedDestinationId ? await replacePayoutDestination(selectedDestinationId, payload) : await createPayoutDestination(payload);
      const destination = ((response as { destination?: PayoutDestination }).destination ?? response) as PayoutDestination;
      const diagnostic = buildDestinationQueueDiagnostic(destination);
      setLastSaveDiagnostic(diagnostic);
      setNotice({ type: diagnostic.shouldAppearInAdminQueue ? "success" : "info", message: diagnostic.summary });
      resetForm();
      await loadData({ silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save destination";
      setDestinationFormError(message);
      setLastSaveDiagnostic(null);
      setNotice({ type: "error", message });
    } finally {
      setSavingDestination(false);
    }
  }, [form, loadData, resetForm, selectedDestinationId, sellerId]);

  const handleMakeDefault = useCallback(async (destination: PayoutDestination) => {
    if (!destination.isActive || destination.isDefault) return;
    setSavingDestination(true);
    try {
      await updatePayoutDestination(destination.id, { isDefault: true });
      setNotice({ type: "success", message: `${destination.providerName} is now your default payout destination.` });
      setLastSaveDiagnostic(null);
      await loadData({ silent: true });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to update default destination" });
    } finally {
      setSavingDestination(false);
    }
  }, [loadData]);

  const handleRemoveDestination = useCallback((destination: PayoutDestination) => {
    if (destination.isDefault) {
      startEdit(destination);
      setNotice({ type: "info", message: "Default payout destination cannot be removed. Replace it in Payout Setup." });
      setLastSaveDiagnostic(null);
      return;
    }
    setRemoveTarget(destination);
    setDestinationFormError(null);
    setNotice(null);
    setLastSaveDiagnostic(null);
  }, [startEdit]);

  const handleConfirmRemoveDestination = useCallback(async () => {
    if (!removeTarget || removeCountdown > 0) return;
    setSavingDestination(true);
    try {
      await deletePayoutDestination(removeTarget.id);
      setNotice({ type: "success", message: `${removeTarget.providerName} payout destination removed.` });
      setLastSaveDiagnostic(null);
      if (selectedDestinationId === removeTarget.id) resetForm();
      setRemoveTarget(null);
      await loadData({ silent: true });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to remove destination" });
    } finally {
      setSavingDestination(false);
    }
  }, [loadData, removeCountdown, removeTarget, resetForm, selectedDestinationId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData({ silent: true });
  }, [loadData]);

  return {
    profileLoading,
    isSeller,
    sellerId,
    permissions,
    destinations,
    payouts,
    escrows,
    providerMetadata,
    connectAccount,
    connectLoading,
    connectError,
    connectDefaultMode: CONNECT_DEFAULT_MODE,
    defaultConnectScope: DEFAULT_CONNECT_SCOPE,
    selectedDestinationId,
    form,
    loading,
    refreshing,
    savingDestination,
    destinationFormError,
    notice,
    lastSaveDiagnostic,
    removeTarget,
    removeCountdown,
    summary,
    earningsSummary,
    activeDestinations,
    canEditSettings,
    canViewHistory,
    loadData,
    startEdit,
    resetForm,
    setForm,
    setRemoveTarget,
    handleConnectRefresh,
    handleConnect,
    handleDisconnect,
    handleSaveDestination,
    handleMakeDefault,
    handleRemoveDestination,
    handleConfirmRemoveDestination,
    handleRefresh,
  };
}
