import { apiFetch } from "./api";
import type {
  MessageBlockScope,
  MessageReport,
  MessageReportReason,
} from "../types";

export interface BlockUserPayload {
  scope?: MessageBlockScope;
  reason?: string;
}

export interface ReportConversationPayload {
  reason: MessageReportReason;
  details?: string;
}

export interface SpamFlagPayload {
  messageId?: number;
}

export async function blockConversationUser(
  conversationId: number,
  payload: BlockUserPayload = {}
) {
  return apiFetch(`/api/messages/${conversationId}/block`, {
    method: "POST",
    body: JSON.stringify({
      scope: payload.scope ?? "messages",
      reason: payload.reason ?? "",
    }),
  });
}

export async function unblockConversationUser(conversationId: number) {
  return apiFetch(`/api/messages/${conversationId}/block`, {
    method: "DELETE",
  });
}

export async function reportConversation(
  conversationId: number,
  payload: ReportConversationPayload
) {
  return apiFetch(`/api/messages/${conversationId}/report`, {
    method: "POST",
    body: JSON.stringify({
      reason: payload.reason,
      details: payload.details ?? "",
    }),
  });
}

export async function markConversationSpam(
  conversationId: number,
  payload: SpamFlagPayload = {}
) {
  return apiFetch(`/api/messages/${conversationId}/spam`, {
    method: "POST",
    body: JSON.stringify({
      messageId: payload.messageId,
    }),
  });
}

export async function fetchMessageReports(status: string = "open") {
  const query = new URLSearchParams();
  if (status !== "all") {
    query.set("status", status);
  }

  const queryString = query.toString();
  const result = await apiFetch(`/api/admin/message-reports${queryString ? `?${queryString}` : ""}`);

  if (result?.data?.items) {
    return result.data.items as MessageReport[];
  }

  return Array.isArray(result?.items)
    ? (result.items as MessageReport[])
    : [];
}

export async function resolveMessageReport(reportId: number) {
  return apiFetch(`/api/admin/message-reports/${reportId}/resolve`, {
    method: "POST",
  });
}
