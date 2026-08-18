import { sendViaBrevo } from "./email.providers/brevo.provider.js";
import type { EmailMessage, EmailSendResult } from "./email.types.js";

export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  return sendViaBrevo(message);
}
