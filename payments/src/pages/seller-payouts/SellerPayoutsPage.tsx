import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import BrandMark from "../../components/BrandMark";
import ConfirmModal from "../../components/ConfirmModal";
import ConnectSettingsCard from "../../components/payouts/ConnectSettingsCard";
import { EXPLORE_PATH, navigateToPath } from "../../lib/appNavigation";
import { getSellerCache } from "../../lib/sellerWorkspaceCache";
import SellerHubPage from "../../SellerHubPage";
import SellerOrdersPage from "../../SellerOrdersPage";
import SellerPayoutsAccessGate from "./components/SellerPayoutsAccessGate";
import SellerPayoutsDestinationsSection from "./components/SellerPayoutsDestinationsSection";
import SellerPayoutsHero from "./components/SellerPayoutsHero";
import SellerPayoutsHistorySection from "./components/SellerPayoutsHistorySection";
import SellerPayoutsNotice from "./components/SellerPayoutsNotice";
import { useSellerPayoutsPage } from "./useSellerPayoutsPage";

export default function SellerPayoutsPage() {
  const view = new URLSearchParams(window.location.search).get("view");

  const {
    profileLoading,
    isSeller,
    sellerId,
    loading,
    refreshing,
    connectAccount,
    connectLoading,
    connectError,
    connectDefaultMode,
    defaultConnectScope,
    notice,
    lastSaveDiagnostic,
    form,
    selectedDestinationId,
    destinationFormError,
    savingDestination,
    canEditSettings,
    canViewHistory,
    activeDestinations,
    providerMetadata,
    summary,
    earningsSummary,
    payouts,
    removeTarget,
    removeCountdown,
    setForm,
    resetForm,
    setRemoveTarget,
    startEdit,
    handleConnectRefresh,
    handleConnect,
    handleDisconnect,
    handleSaveDestination,
    handleMakeDefault,
    handleRemoveDestination,
    handleConfirmRemoveDestination,
    handleRefresh,
  } = useSellerPayoutsPage();

  if (!view || view === "hub") return <SellerHubPage />;
  if (view === "orders") return <SellerOrdersPage />;

  const hasCachedPayoutData = Boolean(sellerId && getSellerCache(`payouts:${sellerId}`));

  if ((profileLoading && !hasCachedPayoutData) || (loading && !hasCachedPayoutData) || (!isSeller && !profileLoading)) {
    return <SellerPayoutsAccessGate loading={profileLoading || loading} isSeller={isSeller} onBack={() => navigateToPath(EXPLORE_PATH)} />;
  }

  const providerOptions = [...providerMetadata.mobileMoneyOperators, ...providerMetadata.banks];

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-zinc-900">
      <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <BrandMark />
          <div className="flex w-full items-center gap-3 sm:w-auto">
            <button type="button" onClick={() => navigateToPath(EXPLORE_PATH)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold hover:bg-zinc-50 sm:flex-none"><ArrowLeft className="h-4 w-4" /> Back</button>
            <button type="button" onClick={() => void handleRefresh()} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 sm:flex-none">{refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
        <SellerPayoutsHero summary={summary} earningsSummary={earningsSummary} payouts={payouts} canEditSettings={canEditSettings} />
        {notice ? <SellerPayoutsNotice type={notice.type} message={notice.message} details={lastSaveDiagnostic?.reasons} /> : null}
        <ConnectSettingsCard connectAccount={connectAccount} connectLoading={connectLoading} connectError={connectError} connectDefaultMode={connectDefaultMode} defaultConnectScope={defaultConnectScope} onRefresh={() => void handleConnectRefresh()} onConnect={() => void handleConnect()} onDisconnect={() => void handleDisconnect()} />
        <SellerPayoutsDestinationsSection form={form} onFormChange={setForm} onSave={handleSaveDestination} onCancel={resetForm} saving={savingDestination} error={destinationFormError} canEditSettings={canEditSettings} isEditing={Boolean(selectedDestinationId)} activeDestinationCount={activeDestinations.length} activeDestinations={activeDestinations} providerOptions={providerOptions} onReplace={startEdit} onRemove={handleRemoveDestination} onMakeDefault={handleMakeDefault} />
        <SellerPayoutsHistorySection payouts={payouts} canViewHistory={canViewHistory} />
      </main>
      <ConfirmModal open={Boolean(removeTarget)} title="Remove payout destination" message={removeTarget ? `Are you sure you want to remove ${removeTarget.providerName} from your payout destinations?` : "Are you sure you want to remove this payout destination?"} cancelText="Cancel" confirmText={removeCountdown > 0 ? `Confirm (${removeCountdown}s)` : "Confirm"} confirmDisabled={savingDestination || removeCountdown > 0} danger onCancel={() => setRemoveTarget(null)} onConfirm={() => void handleConfirmRemoveDestination()} />
    </div>
  );
}
