import { useMemo } from "react";
import { Loader2, Save, ShieldCheck, Trash2 } from "lucide-react";
import FormDropdown from "../FormDropdown";
import type { PayoutProviderOption } from "../../modules/payouts/types";

export type PayoutDestinationType = "mobile_money" | "bank";

export type PayoutDestinationFormValue = {
  destinationType: PayoutDestinationType;
  providerName: string;
  providerRefId: string;
  currency: string;
  accountName: string;
  accountNumber: string;
  mobile: string;
  isDefault: boolean;
};

type PayoutDestinationFormProps = {
  value: PayoutDestinationFormValue;
  onChange: (value: PayoutDestinationFormValue) => void;
  onSave: () => void | Promise<void>;
  onCancel?: () => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  isEditing?: boolean;
  activeDestinationCount?: number;
  providerOptions?: PayoutProviderOption[];
};

const FALLBACK_BANK_OPTIONS: PayoutProviderOption[] = [
  {
    id: "82310dd1-ec9b-4fe7-a32c-2f262ef08681",
    name: "National Bank of Malawi",
    destinationType: "bank",
    providerRefId: "82310dd1-ec9b-4fe7-a32c-2f262ef08681",
  },
  {
    id: "b064172a-8a1b-4f7f-aad7-81b036c46c57",
    name: "FDH Bank Limited",
    destinationType: "bank",
    providerRefId: "b064172a-8a1b-4f7f-aad7-81b036c46c57",
  },
  {
    id: "e7447c2c-c147-4907-b194-e087fe8d8585",
    name: "Standard Bank Limited",
    destinationType: "bank",
    providerRefId: "e7447c2c-c147-4907-b194-e087fe8d8585",
  },
  {
    id: "87e62436-0553-4fb5-a76d-f27d28420c5b",
    name: "Ecobank Malawi Limited",
    destinationType: "bank",
    providerRefId: "87e62436-0553-4fb5-a76d-f27d28420c5b",
  },
    {
    id: "236760c9-3045-4a01-990e-497b28d115bb",
    name: "Centenary Bank",
    destinationType: "bank",
    providerRefId: "236760c9-3045-4a01-990e-497b28d115bb",
  },
  {
    id: "c759d7b6-ae5c-4a95-814a-79171271897a",
    name: "CDH Investment Bank",
    destinationType: "bank",
    providerRefId: "c759d7b6-ae5c-4a95-814a-79171271897a",
  },
  {
    id: "968ac588-3b1f-4d89-81ff-a3d43a599003",
    name: "First Capital Limited",
    destinationType: "bank",
    providerRefId: "968ac588-3b1f-4d89-81ff-a3d43a599003",
  },
  {
    id: "86007bf5-1b04-49ba-84c1-9758bbf5c996",
    name: "NBS Bank Limited",
    destinationType: "bank",
    providerRefId: "86007bf5-1b04-49ba-84c1-9758bbf5c996",
  },
];

const FALLBACK_MOBILE_OPTIONS: PayoutProviderOption[] = [
  {
    id: "e8d5fca0-e5ac-4714-a518-484be9011326",
    name: "Airtel Money",
    destinationType: "mobile_money",
    providerRefId: "e8d5fca0-e5ac-4714-a518-484be9011326",
  },
  {
    id: "5e9946ae-76ed-43f5-ad59-63e09096006a",
    name: "TNM Mpamba",
    destinationType: "mobile_money",
    providerRefId: "5e9946ae-76ed-43f5-ad59-63e09096006a",
  },
];

export default function PayoutDestinationForm({
  value,
  onChange,
  onSave,
  onCancel,
  loading = false,
  error = null,
  disabled = false,
  isEditing = false,
  activeDestinationCount,
  providerOptions = [],
}: PayoutDestinationFormProps) {
  const updateValue = <Key extends keyof PayoutDestinationFormValue>(key: Key, nextValue: PayoutDestinationFormValue[Key]) => {
    onChange({ ...value, [key]: nextValue });
  };

  const availableProviders = useMemo(() => {
    const filtered = providerOptions.filter(
      (option) => option.destinationType === value.destinationType,
    );

    if (filtered.length > 0) {
      return filtered;
    }

    return value.destinationType === "bank"
      ? FALLBACK_BANK_OPTIONS
      : FALLBACK_MOBILE_OPTIONS;
  }, [providerOptions, value.destinationType]);

  const dropdownValue = value.providerRefId || value.providerName;
  const mobilePlaceholder = useMemo(() => {
    const provider = `${value.providerName} ${value.providerRefId}`.toLowerCase();
    if (provider.includes('airtel')) return '09********';
    if (provider.includes('tnm') || provider.includes('mpamba')) return '08********';
    return 'Mobile wallet number';
  }, [value.providerName, value.providerRefId]);

  return (
    <div className="rounded-[28px] border border-zinc-200/80 bg-white p-6 shadow-[0_12px_30px_rgba(0,0,0,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-zinc-400">Payout setup</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight">Add or update your payout destination.</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Choose a PayChangu-supported payout destination. Real provider identifiers are stored securely on the server.
          </p>
        </div>
        {activeDestinationCount !== undefined ? (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-right">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-zinc-400">Active destinations</p>
            <p className="mt-1 text-2xl font-black">{activeDestinationCount}</p>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-zinc-400">Destination type</span>
          <select
            value={value.destinationType}
            onChange={(event) =>
              onChange({
                ...value,
                destinationType: event.target.value as PayoutDestinationType,
                providerName: "",
                providerRefId: "",
              })
            }
            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold outline-none transition focus:border-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500"
            disabled={loading || disabled}
            required
          >
            <option value="mobile_money">Mobile money</option>
            <option value="bank">Bank</option>
          </select>
        </label>

        <FormDropdown
          label={value.destinationType === "bank" ? "Bank" : "Mobile operator"}
          value={dropdownValue}
          onChange={(selectedProviderId) => {
            const selected = availableProviders.find(
              (option) => option.id === selectedProviderId,
            );

            if (!selected) return;

            onChange({
              ...value,
              providerName: selected.name,
              providerRefId: selected.providerRefId || selected.id,
            });
          }}
          options={availableProviders.map((option) => ({
            value: option.id,
            label: option.name,
          }))}
          placeholder={value.destinationType === "bank" ? "Select bank" : "Select mobile operator"}
          searchPlaceholder="Search provider..."
          searchable
          disabled={loading || disabled}
        />

        <label className="space-y-2">
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-zinc-400">Provider identifier</span>
          <input
            value={value.providerRefId}
            readOnly
            className="w-full rounded-2xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-600 outline-none"
            placeholder="Provider ID selected automatically"
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-zinc-400">
            {value.destinationType === "bank" ? "Account name" : "Account holder name"}
          </span>
          <input
            value={value.accountName}
            onChange={(event) => updateValue("accountName", event.target.value)}
            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold outline-none transition focus:border-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500"
            placeholder="Name on bank account or wallet"
            disabled={loading || disabled}
            required
          />
        </label>

        {value.destinationType === "bank" ? (
          <label className="space-y-2 sm:col-span-2">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-zinc-400">Account number</span>
            <input
              value={value.accountNumber}
              onChange={(event) => updateValue("accountNumber", event.target.value)}
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold outline-none transition focus:border-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500"
              placeholder="Bank account number"
              disabled={loading || disabled}
              required
            />
          </label>
        ) : (
          <label className="space-y-2 sm:col-span-2">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-zinc-400">Mobile number</span>
            <input
              value={value.mobile}
              onChange={(event) => updateValue("mobile", event.target.value)}
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold outline-none transition focus:border-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500"
              placeholder={mobilePlaceholder}
              disabled={loading || disabled}
              required
            />
          </label>
        )}

        <label className="space-y-2 sm:col-span-2">
          <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-zinc-400">Currency</span>
          <input
            value={value.currency}
            onChange={(event) => updateValue("currency", event.target.value.toUpperCase())}
            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold outline-none transition focus:border-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500"
            placeholder="MWK"
            disabled={loading || disabled}
            required
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => updateValue("isDefault", !value.isDefault)}
          disabled={loading || disabled}
          className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-bold disabled:opacity-60 ${
            value.isDefault ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          {value.isDefault ? "Default destination" : "Make default"}
        </button>

        <button
          type="button"
          onClick={() => void onSave()}
          disabled={loading || disabled}
          className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isEditing ? "Replace destination" : "Save destination"}
        </button>

        {isEditing && onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" />
            Cancel replace
          </button>
        ) : null}
      </div>
    </div>
  );
}
