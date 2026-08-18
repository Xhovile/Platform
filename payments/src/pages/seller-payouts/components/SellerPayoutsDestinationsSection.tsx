import { type ReactNode } from "react";
import { Building2 } from "lucide-react";
import PayoutDestinationCard from "../../../components/payouts/PayoutDestinationCard";
import PayoutDestinationForm from "../../../components/payouts/PayoutDestinationForm";
import type {
  PayoutDestination,
  PayoutDestinationFormState,
  PayoutProviderOption,
} from "../../../modules/payouts/types";
import { formatDate } from "../sellerPayouts.helpers";

function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-zinc-400">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight">{title}</h2>
      </div>
      {action ? action : null}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-5 text-sm text-zinc-600">
      {children}
    </div>
  );
}

export default function SellerPayoutsDestinationsSection({
  form,
  onFormChange,
  onSave,
  onCancel,
  saving,
  error,
  canEditSettings,
  isEditing,
  activeDestinationCount,
  activeDestinations,
  providerOptions,
  onReplace,
  onRemove,
  onMakeDefault,
}: {
  form: PayoutDestinationFormState;
  onFormChange: (value: PayoutDestinationFormState) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  canEditSettings: boolean;
  isEditing: boolean;
  activeDestinationCount: number;
  activeDestinations: PayoutDestination[];
  providerOptions: PayoutProviderOption[];
  onReplace: (destination: PayoutDestination) => void;
  onRemove: (destination: PayoutDestination) => void;
  onMakeDefault: (destination: PayoutDestination) => void;
}) {
  return (
    <section
      id="payout-destination-settings"
      className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]"
    >
      <PayoutDestinationForm
        value={form}
        onChange={onFormChange}
        onSave={onSave}
        onCancel={onCancel}
        loading={saving}
        error={error}
        disabled={!canEditSettings}
        isEditing={isEditing}
        activeDestinationCount={activeDestinationCount}
        providerOptions={providerOptions}
      />

      <div className="min-w-0 rounded-[28px] border border-zinc-200/80 bg-white p-6 shadow-[0_12px_30px_rgba(0,0,0,0.04)]">
        <SectionTitle
          eyebrow="Saved destinations"
          title="Active payout routes."
          action={<Building2 className="h-5 w-5 text-zinc-400" />}
        />

        <div className="mt-5 space-y-3">
          {activeDestinations.length === 0 ? (
            <EmptyState>No payout destination yet.</EmptyState>
          ) : (
            activeDestinations.map((destination) => (
              <PayoutDestinationCard
                key={destination.id}
                destination={destination}
                onReplace={onReplace}
                onRemove={onRemove}
                onMakeDefault={onMakeDefault}
                formatDate={formatDate}
                actionsDisabled={!canEditSettings || saving}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
