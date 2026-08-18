function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderOrderPaidEmail(params: {
  recipientName: string;
  role: "buyer" | "seller";
  counterpartyName: string;
  orderId: string;
  totalAmount: number;
  currency: string;
  actionUrl: string;
}) {
  const recipientName = escapeHtml(params.recipientName);
  const counterpartyName = escapeHtml(params.counterpartyName);
  const orderId = escapeHtml(params.orderId);
  const currency = escapeHtml(params.currency);
  const actionUrl = escapeHtml(params.actionUrl);
  const formattedTotal = `${params.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${params.currency}`;
  const isBuyer = params.role === "buyer";
  const title = isBuyer ? "Payment confirmed" : "You have a new paid order";
  const intro = isBuyer
    ? `Your payment to ${counterpartyName} has been confirmed and your BuyMesho order is now being processed.`
    : `${counterpartyName} has successfully paid for an order connected to your BuyMesho listing.`;

  const text = [
    `Hello ${params.recipientName},`,
    "",
    intro,
    "",
    `${isBuyer ? "Seller" : "Buyer"}: ${params.counterpartyName}`,
    `Order: ${params.orderId}`,
    `Amount: ${formattedTotal}`,
    "",
    `View your order: ${params.actionUrl}`,
    "",
    "BuyMesho",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 16px;">${title}</h2>
      <p style="margin: 0 0 12px;">Hello ${recipientName},</p>
      <p style="margin: 0 0 18px;">${intro}</p>
      <div style="margin: 0 0 20px; padding: 14px 16px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px;">
        <p style="margin: 0 0 6px;"><strong>${isBuyer ? "Seller" : "Buyer"}:</strong> ${counterpartyName}</p>
        <p style="margin: 0 0 6px;"><strong>Order:</strong> ${orderId}</p>
        <p style="margin: 0;"><strong>Amount:</strong> ${escapeHtml(formattedTotal)}</p>
      </div>
      <p style="margin: 0 0 20px;">
        <a href="${actionUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">View order</a>
      </p>
      <p style="margin: 0; font-size: 14px; color: #6b7280;">If you did not expect this message, please contact BuyMesho Support.</p>
    </div>
  `;

  return { text, html, currency };
}
