function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderVerificationEmail(params: {
  recipientName: string;
  verificationLink: string;
}) {
  const recipientName = escapeHtml(params.recipientName);
  const verificationLink = escapeHtml(params.verificationLink);

  const text = [
    `Hello ${params.recipientName},`,
    "",
    "Please verify your email address for BuyMesho.",
    `Open this link to complete verification: ${params.verificationLink}`,
    "",
    "If you did not create this account, you can ignore this email.",
    "",
    "BuyMesho",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 16px;">Verify your email</h2>
      <p style="margin: 0 0 12px;">Hello ${recipientName},</p>
      <p style="margin: 0 0 16px;">
        Please verify your email address for <strong>BuyMesho</strong>.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${verificationLink}"
           style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
          Verify email
        </a>
      </p>
      <p style="margin: 0 0 12px; font-size: 14px; color: #4b5563;">
        Or copy and paste this link into your browser:
      </p>
      <p style="margin: 0 0 16px; font-size: 14px; word-break: break-all; color: #2563eb;">${verificationLink}</p>
      <p style="margin: 0; font-size: 14px; color: #6b7280;">
        If you did not create this account, ignore this email.
      </p>
    </div>
  `;

  return { text, html };
}
