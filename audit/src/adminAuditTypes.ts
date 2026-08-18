export const ADMIN_ACTION_TYPES = {
  APPROVE_SELLER_APPLICATION: "approve_seller_application",
  REJECT_SELLER_APPLICATION: "reject_seller_application",
  HIDE_LISTING: "hide_listing",
  UNHIDE_LISTING: "unhide_listing",
  SUSPEND_SELLER: "suspend_seller",
  UNSUSPEND_SELLER: "unsuspend_seller",
  SUSPEND_PAYOUTS: "suspend_payouts",
  UNSUSPEND_PAYOUTS: "unsuspend_payouts",

  APPROVE_PAYOUT_DESTINATION: "approve_payout_destination",

  PAYOUT_STATUS_SYNCED: "payout_status_synced",
  ADMIN_MARK_PAID: "admin_mark_paid",
  ADMIN_MARK_FAILED: "admin_mark_failed",
  ADMIN_CANCEL_PAYOUT: "admin_cancel",
  ADMIN_HOLD_PAYOUT: "admin_hold",

  SUSPEND_EVENT_CREATOR: "suspend_event_creator",
  UNSUSPEND_EVENT_CREATOR: "unsuspend_event_creator",
  PUBLISH_EVENT: "publish_event",
  HIDE_EVENT: "hide_event",
  CANCEL_EVENT: "cancel_event",
  DELETE_EVENT: "delete_event",

  ADMIN_BLOCK_CONVERSATION_USER: "admin_block_conversation_user",
  ADMIN_UNBLOCK_CONVERSATION_USER: "admin_unblock_conversation_user",
  ADMIN_RESTRICT_MESSAGING: "admin_restrict_messaging",
  ADMIN_UNRESTRICT_MESSAGING: "admin_unrestrict_messaging",
  ADMIN_SUSPEND_ACCOUNT: "admin_suspend_account",
  ADMIN_UNSUSPEND_ACCOUNT: "admin_unsuspend_account",
  ADMIN_MARK_CONVERSATION_SPAM: "admin_mark_conversation_spam",
  ADMIN_REVIEW_CONVERSATION: "admin_review_conversation",
  ADMIN_REVIEW_REPORT: "admin_review_report",
  ADMIN_RESOLVE_REPORT: "admin_resolve_report",
  ADMIN_DISMISS_REPORT: "admin_dismiss_report",

  RUN_DIAGNOSTICS: "run_diagnostics",
} as const;

export const ADMIN_TARGET_TYPES = {
  SELLER_APPLICATION: "seller_application",
  LISTING: "listing",
  SELLER: "seller",

  PAYOUT_DESTINATION: "payout_destination",
  PAYOUT: "payout",

  EVENT_CREATOR: "event_creator",
  EVENT: "event",

  CONVERSATION: "conversation",
  CONVERSATION_USER: "conversation_user",
  MESSAGE_REPORT: "message_report",

  SYSTEM: "system",
} as const;

export type AdminActionType = (typeof ADMIN_ACTION_TYPES)[keyof typeof ADMIN_ACTION_TYPES];
export type AdminTargetType = (typeof ADMIN_TARGET_TYPES)[keyof typeof ADMIN_TARGET_TYPES];

export const ADMIN_ACTION_LABELS: Record<AdminActionType, string> = {
  [ADMIN_ACTION_TYPES.APPROVE_SELLER_APPLICATION]: "Approved seller application",
  [ADMIN_ACTION_TYPES.REJECT_SELLER_APPLICATION]: "Rejected seller application",
  [ADMIN_ACTION_TYPES.HIDE_LISTING]: "Hid listing",
  [ADMIN_ACTION_TYPES.UNHIDE_LISTING]: "Unhid listing",
  [ADMIN_ACTION_TYPES.SUSPEND_SELLER]: "Suspended seller",
  [ADMIN_ACTION_TYPES.UNSUSPEND_SELLER]: "Unsuspended seller",
  [ADMIN_ACTION_TYPES.SUSPEND_PAYOUTS]: "Suspended payouts",
  [ADMIN_ACTION_TYPES.UNSUSPEND_PAYOUTS]: "Unsuspended payouts",
  [ADMIN_ACTION_TYPES.APPROVE_PAYOUT_DESTINATION]: "Approved payout destination",
  [ADMIN_ACTION_TYPES.PAYOUT_STATUS_SYNCED]: "Reconciled payout status",
  [ADMIN_ACTION_TYPES.ADMIN_MARK_PAID]: "Confirmed as paid",
  [ADMIN_ACTION_TYPES.ADMIN_MARK_FAILED]: "Marked payout failed",
  [ADMIN_ACTION_TYPES.ADMIN_CANCEL_PAYOUT]: "Cancelled payout",
  [ADMIN_ACTION_TYPES.ADMIN_HOLD_PAYOUT]: "Held payout",
  [ADMIN_ACTION_TYPES.SUSPEND_EVENT_CREATOR]: "Suspended event creator",
  [ADMIN_ACTION_TYPES.UNSUSPEND_EVENT_CREATOR]: "Unsuspended event creator",
  [ADMIN_ACTION_TYPES.PUBLISH_EVENT]: "Published event",
  [ADMIN_ACTION_TYPES.HIDE_EVENT]: "Hid event",
  [ADMIN_ACTION_TYPES.CANCEL_EVENT]: "Cancelled event",
  [ADMIN_ACTION_TYPES.DELETE_EVENT]: "Deleted event",
  [ADMIN_ACTION_TYPES.ADMIN_BLOCK_CONVERSATION_USER]: "Blocked conversation participant",
  [ADMIN_ACTION_TYPES.ADMIN_UNBLOCK_CONVERSATION_USER]: "Unblocked conversation participant",
  [ADMIN_ACTION_TYPES.ADMIN_RESTRICT_MESSAGING]: "Restricted messaging",
  [ADMIN_ACTION_TYPES.ADMIN_UNRESTRICT_MESSAGING]: "Removed messaging restriction",
  [ADMIN_ACTION_TYPES.ADMIN_SUSPEND_ACCOUNT]: "Suspended account",
  [ADMIN_ACTION_TYPES.ADMIN_UNSUSPEND_ACCOUNT]: "Unsuspended account",
  [ADMIN_ACTION_TYPES.ADMIN_MARK_CONVERSATION_SPAM]: "Marked conversation spam",
  [ADMIN_ACTION_TYPES.ADMIN_REVIEW_CONVERSATION]: "Reviewed conversation",
  [ADMIN_ACTION_TYPES.ADMIN_REVIEW_REPORT]: "Reviewed message report",
  [ADMIN_ACTION_TYPES.ADMIN_RESOLVE_REPORT]: "Resolved message report",
  [ADMIN_ACTION_TYPES.ADMIN_DISMISS_REPORT]: "Dismissed message report",
  [ADMIN_ACTION_TYPES.RUN_DIAGNOSTICS]: "Ran system diagnostics",
};

export const ADMIN_TARGET_LABELS: Record<AdminTargetType, string> = {
  [ADMIN_TARGET_TYPES.SELLER_APPLICATION]: "Seller application",
  [ADMIN_TARGET_TYPES.LISTING]: "Listing",
  [ADMIN_TARGET_TYPES.SELLER]: "Seller",
  [ADMIN_TARGET_TYPES.PAYOUT_DESTINATION]: "Payout destination",
  [ADMIN_TARGET_TYPES.PAYOUT]: "Payout",
  [ADMIN_TARGET_TYPES.EVENT_CREATOR]: "Event creator",
  [ADMIN_TARGET_TYPES.EVENT]: "Event",
  [ADMIN_TARGET_TYPES.CONVERSATION]: "Conversation",
  [ADMIN_TARGET_TYPES.CONVERSATION_USER]: "Conversation participant",
  [ADMIN_TARGET_TYPES.MESSAGE_REPORT]: "Message report",
  [ADMIN_TARGET_TYPES.SYSTEM]: "System",
};

export function isAdminActionType(value: string): value is AdminActionType {
  return Object.values(ADMIN_ACTION_TYPES).includes(value as AdminActionType);
}

export function isAdminTargetType(value: string): value is AdminTargetType {
  return Object.values(ADMIN_TARGET_TYPES).includes(value as AdminTargetType);
}
