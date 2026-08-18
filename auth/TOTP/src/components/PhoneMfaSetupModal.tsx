import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Loader2, Phone, ShieldCheck, User, X } from "lucide-react";

type PhoneMfaSetupModalProps = {
  open: boolean;
  title: string;
  message: string;
  recaptchaContainerId: string;
  phoneNumber: string;
  displayName: string;
  verificationCode: string;
  codeSent: boolean;
  busy?: boolean;
  onPhoneNumberChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onVerificationCodeChange: (value: string) => void;
  onSendCode: () => void;
  onVerifyCode: () => void;
  onBack?: () => void;
  onClose: () => void;
};

export default function PhoneMfaSetupModal({
  open,
  title,
  message,
  recaptchaContainerId,
  phoneNumber,
  displayName,
  verificationCode,
  codeSent,
  busy,
  onPhoneNumberChange,
  onDisplayNameChange,
  onVerificationCodeChange,
  onSendCode,
  onVerifyCode,
  onBack,
  onClose,
}: PhoneMfaSetupModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 18 }}
            className="relative w-full max-w-xl rounded-3xl bg-white shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-zinc-700" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-zinc-900">{title}</h3>
                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">
                    SMS second factor
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-full hover:bg-zinc-100 transition-colors"
              >
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-zinc-600 leading-6">{message}</p>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-zinc-400">
                  Status
                </p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">
                  {codeSent ? "Code sent — enter the 6-digit SMS code" : "Enter your phone number to get a code"}
                </p>
              </div>

              {!codeSent ? (
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-zinc-600">
                      Phone number
                    </label>
                    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3">
                      <Phone className="w-4 h-4 text-zinc-400" />
                      <input
                        type="tel"
                        inputMode="tel"
                        placeholder="+265..."
                        value={phoneNumber}
                        onChange={(e) => onPhoneNumberChange(e.target.value)}
                        className="w-full bg-transparent text-base outline-none placeholder:text-zinc-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-zinc-600">
                      Display name
                    </label>
                    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3">
                      <User className="w-4 h-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="BuyMesho phone"
                        value={displayName}
                        onChange={(e) => onDisplayNameChange(e.target.value)}
                        className="w-full bg-transparent text-base outline-none placeholder:text-zinc-400"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="mb-2 block text-sm font-medium text-zinc-600">
                    SMS verification code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={verificationCode}
                    onChange={(e) => onVerificationCodeChange(e.target.value)}
                    placeholder="Enter 6-digit code"
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-zinc-900/10"
                  />
                </div>
              )}

              <div id={recaptchaContainerId} className="hidden" />
            </div>

            <div className="px-6 pb-6 flex flex-col sm:flex-row gap-3">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="flex-1 py-3 rounded-2xl font-bold border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors"
                >
                  Back
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl font-bold bg-zinc-100 hover:bg-zinc-200 transition-colors"
              >
                Cancel
              </button>

              {codeSent ? (
                <button
                  type="button"
                  onClick={onVerifyCode}
                  disabled={busy}
                  className="flex-1 py-3 rounded-2xl font-bold text-white bg-zinc-900 hover:bg-zinc-800 transition-colors inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Verify code
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSendCode}
                  disabled={busy}
                  className="flex-1 py-3 rounded-2xl font-bold text-white bg-zinc-900 hover:bg-zinc-800 transition-colors inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Send code
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
