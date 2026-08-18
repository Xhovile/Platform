import { useEffect, useRef, useState } from "react";
import { Ban, Flag, MoreVertical, OctagonAlert, Trash2 } from "lucide-react";
import type { MessageBlockScope } from "../../types";

export interface ConversationActionsMenuProps {
  onDelete?: () => void;
  onBlock?: (scope?: MessageBlockScope) => void;
  onUnblock?: () => void;
  onReport?: () => void;
  onSpam?: () => void;
  blockedByYou?: boolean;
  blockedByOther?: boolean;
  className?: string;
}

export default function ConversationActionsMenu({
  onDelete,
  onBlock,
  onUnblock,
  onReport,
  onSpam,
  blockedByYou = false,
  blockedByOther = false,
  className = "",
}: ConversationActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conversation actions"
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl">
          {onDelete ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              <Trash2 className="h-4 w-4 text-zinc-500" />
              Delete chat
            </button>
          ) : null}

          {onReport ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onReport();
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              <Flag className="h-4 w-4 text-zinc-500" />
              Report conversation
            </button>
          ) : null}

          {onSpam ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSpam();
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              <OctagonAlert className="h-4 w-4 text-zinc-500" />
              Mark as spam
            </button>
          ) : null}

          {blockedByYou ? (
            onUnblock ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onUnblock();
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
              >
                <Ban className="h-4 w-4 text-zinc-500" />
                Unblock user
              </button>
            ) : null
          ) : onBlock ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onBlock("messages");
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              <Ban className="h-4 w-4 text-zinc-500" />
              Block user
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
