import { useEffect, useState } from "react";
import type { MessageReportReason } from "../../types";
import ActionConfirmDialog from "./ActionConfirmDialog";

const REPORT_REASONS: { value: MessageReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "scam", label: "Scam" },
  { value: "harassment", label: "Harassment" },
  { value: "fake_listing", label: "Fake listing" },
  { value: "abusive_language", label: "Abusive language" },
  { value: "off_platform_fraud", label: "Off-platform fraud" },
];

export interface MessageReportDialogProps {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (payload: { reason: MessageReportReason; details: string }) => void | Promise<void>;
}

export default function MessageReportDialog({
  open,
  busy = false,
  onClose,
  onSubmit,
}: MessageReportDialogProps) {
  const [reason, setReason] = useState<MessageReportReason>("spam");
  const [details, setDetails] = useState("");

  useEffect(() => {
    if (open) {
      setReason("spam");
      setDetails("");
    }
  }, [open]);

  return (
    <ActionConfirmDialog
      open={open}
      title="Report conversation"
      description="Choose the reason that best matches the issue. The report goes to moderation for review."
      confirmLabel="Submit report"
      tone="danger"
      busy={busy}
      onClose={onClose}
      onConfirm={() => onSubmit({ reason, details })}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-zinc-800">Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as MessageReportReason)}
            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none"
          >
            {REPORT_REASONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-zinc-800">Details</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
            placeholder="Add context for moderation, if needed."
            className="w-full resize-none rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none"
          />
        </label>
      </div>
    </ActionConfirmDialog>
  );
}
