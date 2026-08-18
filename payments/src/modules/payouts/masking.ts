export function maskAccountLast4(value?: string | null): string | null {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `•••• ${digits.slice(-4)}`;
}

