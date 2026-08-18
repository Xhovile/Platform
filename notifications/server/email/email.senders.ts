import type { EmailSenderKey } from "./email.types.js";

export const EMAIL_SENDERS: Record<EmailSenderKey, { name: string; email: string }> = {
  general: {
    name: "BuyMesho",
    email: "buymesho@buymesho.me",
  },
  transactional: {
    name: "BuyMesho",
    email: "no-reply@buymesho.me",
  },
  notifications: {
    name: "BuyMesho",
    email: "notifications@buymesho.me",
  },
  support: {
    name: "BuyMesho Support",
    email: "support@buymesho.me",
  },
  management: {
    name: "BuyMesho Management",
    email: "management@buymesho.me",
  },
};
