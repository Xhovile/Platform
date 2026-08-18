import { X } from "lucide-react";

export type TotpChallengeModalProps = {
  open: boolean;
  title: string;
  message: string;
  code: string;
  busy?: boolean;
  onCodeChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export default function TotpChallengeModal({
  open,
  title,
  message,
  code,
  busy,
  onCodeChange,
  onSubmit,
  onCancel,
}: TotpChallengeModalProps) {
  if (!open) return null;

  const displayTitle = title === "Two-factor verification" ? "Two-factor authentication" : title;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-zinc-400">Security</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{displayTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">{message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Close two-factor authentication"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-zinc-700">Authenticator code</label>
            <input
              autoFocus
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-lg font-semibold tracking-[0.3em] outline-none focus:border-zinc-900"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-2xl border border-zinc-200 bg-white px-4 py-3 font-bold text-zinc-900 hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onSubmit}
              className="flex-1 rounded-2xl bg-zinc-900 px-4 py-3 font-bold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Verifying..." : "Verify"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
