export type EmailSenderKey =
  | "general"
  | "transactional"
  | "notifications"
  | "support"
  | "management";

export type EmailRecipient = {
  email: string;
  name?: string | null;
};

export type EmailMessage = {
  to: EmailRecipient | EmailRecipient[];
  sender: EmailSenderKey;
  subject: string;
  text?: string;
  html: string;
};

export type EmailSendResult = {
  messageId: string;
};
