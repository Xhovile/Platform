function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmailChangeEmail(params: {
  recipientName: string;
  newEmail: string;
  verificationLink: string;
}) {
  const recipientName = escapeHtml(params.recipientName);
  const newEmail = escapeHtml(params.newEmail);
  const verificationLink = escapeHtml(params.verificationLink);

  const text = [
    `Hello ${params.recipientName},`,
    "",
    "We received a request to change the email address on your BuyMesho account.",
    `The new email address is: ${params.newEmail}`,
    `Open this link to confirm the change: ${params.verificationLink}`,
    "",
    "If you did not request this change, ignore this email and contact BuyMesho support if you are concerned about your account.",
    "",
    "BuyMesho",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 16px;">Confirm your new email</h2>
      <p style="margin: 0 0 12px;">Hello ${recipientName},</p>
      <p style="margin: 0 0 16px;">
        We received a request to change the email address on your <strong>BuyMesho</strong> account.
      </p>
      <p style="margin: 0 0 16px;">
        New email: <strong>${newEmail}</strong>
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${verificationLink}"
           style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
          Confirm email change
        </a>
      </p>
      <p style="margin: 0 0 12px; font-size: 14px; color: #4b5563;">
        Or copy and paste this link into your browser:
      </p>
      <p style="margin: 0 0 16px; font-size: 14px; word-break: break-all; color: #2563eb;">${verificationLink}</p>
      <p style="margin: 0; font-size: 14px; color: #6b7280;">
        If you did not request this change, ignore this email and contact BuyMesho support if needed.
      </p>
    </div>
  `;

  return { text, html };
}
