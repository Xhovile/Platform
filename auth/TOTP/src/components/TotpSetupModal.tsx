import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, Copy, ShieldCheck, X } from "lucide-react";

export type TotpSetupModalProps = {
  open: boolean;
  title: string;
  message: string;
  qrCodeUrl: string;
  otpauthUri?: string;
  secret: string;
  accountName: string;
  code: string;
  busy?: boolean;
  onCodeChange: (value: string) => void;
  onConfirm: () => void;
  onDisable?: () => void;
  onBack?: () => void;
  onClose: () => void;
};

export default function TotpSetupModal({
  open,
  title,
  message,
  qrCodeUrl,
  secret,
  accountName,
  code,
  busy,
  onCodeChange,
  onConfirm,
  onDisable,
  onBack,
  onClose,
}: TotpSetupModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [secretCopied, setSecretCopied] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setSecretCopied(false);
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (open && step === 2) {
      window.setTimeout(() => codeInputRef.current?.focus(), 120);
    }
  }, [open, step]);

  const handleCopySecret = async () => {
    if (!secret || !navigator.clipboard?.writeText) return;

    await navigator.clipboard
      .writeText(secret)
      .then(() => {
        setSecretCopied(true);
        window.setTimeout(() => setSecretCopied(false), 1600);
      })
      .catch(() => undefined);
  };

  const handleClose = () => {
    setStep(1);
    setSecretCopied(false);
    onClose();
  };

  const handleTopBack = () => {
    if (step === 2) {
      setStep(1);
      return;
    }

    if (onBack) {
      onBack();
      return;
    }

    handleClose();
  };

  const goToManualSetup = () => setStep(2);
  const goToQrSetup = () => setStep(1);

  if (!open) return null;

  const progressLabel = step === 1 ? "1 of 2" : "2 of 2";
  const confirmDisabled = Boolean(busy) || code.length !== 6;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="totp-setup-title"
        className="flex h-dvh w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[min(90dvh,760px)] sm:max-w-2xl sm:rounded-3xl sm:border sm:border-zinc-200"
      >
        <div className="shrink-0 border-b border-zinc-100 bg-white px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white sm:h-10 sm:w-10">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-zinc-400">
                  Two-factor authentication
                </p>
                <h2 id="totp-setup-title" className="mt-2 text-xl font-black tracking-tight text-zinc-900 sm:text-2xl">
                  {step === 1 ? title : "Finish setup"}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                  {step === 1
                    ? message
                    : "Enter the current 6-digit code from your authenticator app to finish setup."}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleTopBack}
              className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-900 transition-colors hover:bg-zinc-50"
              aria-label={step === 2 ? "Go back to QR setup" : onBack ? "Go back" : "Close TOTP setup"}
            >
              {step === 2 ? <ChevronLeft className="h-4 w-4" /> : onBack ? <ChevronLeft className="h-4 w-4" /> : <X className="h-4 w-4" />}
              <span>{step === 2 || onBack ? "Back" : "Close"}</span>
            </button>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5" aria-label={`Step ${progressLabel}`}>
              <span className={`h-1.5 w-10 rounded-full ${step === 1 ? "bg-zinc-900" : "bg-zinc-200"}`} />
              <span className={`h-1.5 w-10 rounded-full ${step === 2 ? "bg-zinc-900" : "bg-zinc-200"}`} />
            </div>
            <span className="text-xs font-bold text-zinc-400">{progressLabel}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div
            className="flex h-full w-[200%] transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ transform: `translateX(-${step === 1 ? 0 : 50}%)` }}
          >
            <section
              className="flex w-1/2 shrink-0 flex-col overflow-y-auto px-5 py-6 sm:px-6 sm:py-7"
              aria-label="QR code setup"
            >
              <div className="mx-auto w-full max-w-md">
                <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
                  <div className="flex justify-center">
                    {qrCodeUrl ? (
                      <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
                        <img
                          src={qrCodeUrl}
                          alt="Scan this QR code with your authenticator app"
                          className="h-52 w-52 rounded-xl object-contain sm:h-64 sm:w-64"
                        />
                      </div>
                    ) : (
                      <div className="flex h-52 w-52 items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white text-center text-sm text-zinc-500 sm:h-64 sm:w-64">
                        QR code not available
                      </div>
                    )}
                  </div>
                  <p className="mt-4 text-center text-sm font-semibold leading-relaxed text-zinc-600">
                    Scan this QR code with Google Authenticator, Microsoft Authenticator, Authy, or another TOTP-compatible app.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={goToManualSetup}
                  className="mt-5 flex w-full items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-left transition-colors hover:bg-zinc-50"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-zinc-900">Can't scan? Use setup key</span>
                    <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
                      Enter the key manually in your authenticator app.
                    </span>
                  </span>
                  <ChevronLeft className="h-4 w-4 shrink-0 rotate-180 text-zinc-400" aria-hidden="true" />
                </button>
              </div>
            </section>

            <section
              className="flex w-1/2 shrink-0 flex-col overflow-y-auto px-5 py-6 sm:px-6 sm:py-7"
              aria-label="Manual authenticator setup"
            >
              <div className="mx-auto w-full max-w-md space-y-5">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-zinc-400">Account</p>
                  <p className="mt-1 break-words text-sm font-semibold text-zinc-900">{accountName}</p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-zinc-400">Setup key</p>
                    <button
                      type="button"
                      onClick={() => void handleCopySecret()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-bold text-zinc-700 transition-colors hover:bg-zinc-100"
                    >
                      {secretCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {secretCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="mt-3 break-all font-mono text-sm font-semibold tracking-[0.08em] text-zinc-950">
                    {secret}
                  </p>
                  <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                    Keep this setup key private. Anyone with it can generate your authentication codes.
                  </p>
                </div>

                <div>
                  <label htmlFor="totp-verification-code" className="mb-2 block text-sm font-bold text-zinc-800">
                    6-digit code
                  </label>
                  <input
                    ref={codeInputRef}
                    id="totp-verification-code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-lg font-semibold tracking-[0.3em] outline-none transition-colors focus:border-zinc-900"
                  />
                  <p className="mt-2 text-xs text-zinc-500">
                    Enter the current code shown for this account in your authenticator app.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="shrink-0 border-t border-zinc-100 bg-white px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            {onDisable ? (
              <button
                type="button"
                onClick={onDisable}
                disabled={busy}
                className="hidden rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-bold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
              >
                Disable 2FA
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleClose}
              className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 font-bold text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              Close
            </button>

            {step === 1 ? (
              <button
                type="button"
                onClick={goToManualSetup}
                className="ml-auto inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 font-bold text-white transition-colors hover:bg-zinc-800"
              >
                Next
                <ChevronLeft className="h-4 w-4 rotate-180" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                disabled={confirmDisabled}
                onClick={onConfirm}
                className="ml-auto rounded-2xl bg-zinc-900 px-4 py-3 font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Verifying..." : "Confirm setup"}
              </button>
            )}
          </div>

          {step === 2 ? (
            <button
              type="button"
              onClick={goToQrSetup}
              className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-900"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back to QR code
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
