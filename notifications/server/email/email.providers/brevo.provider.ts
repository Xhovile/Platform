import { getEmailConfig } from "../email.config.js";
import { EMAIL_SENDERS } from "../email.senders.js";
import type { EmailMessage, EmailRecipient, EmailSendResult } from "../email.types.js";

function normalizeRecipients(to: EmailRecipient | EmailRecipient[]) {
  return Array.isArray(to) ? to : [to];
}

export async function sendViaBrevo(message: EmailMessage): Promise<EmailSendResult> {
  const config = getEmailConfig();
  const sender = EMAIL_SENDERS[message.sender];

  const response = await fetch(`${config.apiBaseUrl}/smtp/email`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": config.brevoApiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender,
      to: normalizeRecipients(message.to),
      subject: message.subject,
      ...(message.text ? { textContent: message.text } : {}),
      htmlContent: message.html,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Brevo email request failed (${response.status}): ${responseText || response.statusText}`,
    );
  }

  const result = (await response.json()) as { messageId?: string };
  if (!result.messageId) {
    throw new Error("Brevo accepted the email request without returning a message ID.");
  }

  return { messageId: result.messageId };
}
