function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPasswordResetEmail(params: {
  recipientName: string;
  resetLink: string;
}) {
  const recipientName = escapeHtml(params.recipientName);
  const resetLink = escapeHtml(params.resetLink);

  const text = [
    `Hello ${params.recipientName},`,
    "",
    "We received a request to reset your BuyMesho password.",
    `Open this link to choose a new password: ${params.resetLink}`,
    "",
    "If you did not request a password reset, you can ignore this email.",
    "",
    "BuyMesho",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 16px;">Reset your password</h2>
      <p style="margin: 0 0 12px;">Hello ${recipientName},</p>
      <p style="margin: 0 0 16px;">
        We received a request to reset your <strong>BuyMesho</strong> password.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${resetLink}"
           style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
          Reset password
        </a>
      </p>
      <p style="margin: 0 0 12px; font-size: 14px; color: #4b5563;">
        Or copy and paste this link into your browser:
      </p>
      <p style="margin: 0 0 16px; font-size: 14px; word-break: break-all; color: #2563eb;">${resetLink}</p>
      <p style="margin: 0; font-size: 14px; color: #6b7280;">
        If you did not request a password reset, you can ignore this email.
      </p>
    </div>
  `;

  return { text, html };
}
