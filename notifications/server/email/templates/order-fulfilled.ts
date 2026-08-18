function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderOrderFulfilledEmail(params: {
  recipientName: string;
  orderId: string;
  totalAmount: number;
  currency: string;
  actionUrl: string;
  counterpartyName?: string | null;
  role: "buyer" | "seller";
}) {
  const recipientName = escapeHtml(params.recipientName);
  const orderId = escapeHtml(params.orderId);
  const currency = escapeHtml(params.currency);
  const counterpartyName = escapeHtml(params.counterpartyName || "");
  const actionUrl = escapeHtml(params.actionUrl);
  const amount = `${currency} ${params.totalAmount.toFixed(2)}`;

  const buyerText = [
    "Hello " + params.recipientName + ",",
    "",
    "You have successfully confirmed delivery of your order. It was a pleasure doing business with you.",
    "Order: " + params.orderId,
    "Total: " + amount,
    params.counterpartyName ? "Seller: " + params.counterpartyName : "",
    "",
    "You can view the order details in BuyMesho.",
    params.actionUrl,
    "",
    "BuyMesho",
  ].filter(Boolean).join("\n");

  const sellerText = [
    "Hello " + params.recipientName + ",",
    "",
    (params.counterpartyName || "The buyer") + " has confirmed delivery of the order. Please check the Seller Payouts page for information about the transaction and payout status.",
    "Order: " + params.orderId,
    "Total: " + amount,
    "",
    "You can view the transaction and payout information in BuyMesho.",
    params.actionUrl,
    "",
    "BuyMesho",
  ].join("\n");

  const buyerHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #111827; max-width: 620px;">
      <h2 style="margin: 0 0 16px;">BuyMesho Order Completion Confirmation</h2>
      <p style="margin: 0 0 12px;">Hello ${recipientName},</p>
      <p style="margin: 0 0 16px;">
        You have successfully confirmed delivery of your order. It was a pleasure doing business with you.
      </p>
      <div style="margin: 0 0 20px; padding: 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px;">
        <p style="margin: 0 0 6px;"><strong>Order:</strong> ${orderId}</p>
        <p style="margin: 0 0 6px;"><strong>Total:</strong> ${amount}</p>
        ${params.counterpartyName ? `<p style="margin: 0;"><strong>Seller:</strong> ${counterpartyName}</p>` : ""}
      </div>
      <p style="margin: 0 0 20px;">
        <a href="${actionUrl}"
           style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
          View order
        </a>
      </p>
      <p style="margin: 0; font-size: 14px; color: #6b7280;">
        BuyMesho
      </p>
    </div>
  `;

  const sellerHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #111827; max-width: 620px;">
      <h2 style="margin: 0 0 16px;">BuyMesho Order Completion Confirmation</h2>
      <p style="margin: 0 0 12px;">Hello ${recipientName},</p>
      <p style="margin: 0 0 16px;">
        <strong>${counterpartyName || "The buyer"}</strong> has confirmed delivery of the order. Please check the Seller Payouts page for information about the transaction and payout status.
      </p>
      <div style="margin: 0 0 20px; padding: 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px;">
        <p style="margin: 0 0 6px;"><strong>Order:</strong> ${orderId}</p>
        <p style="margin: 0;"><strong>Total:</strong> ${amount}</p>
      </div>
      <p style="margin: 0 0 20px;">
        <a href="${actionUrl}"
           style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
          View payout information
        </a>
      </p>
      <p style="margin: 0; font-size: 14px; color: #6b7280;">
        BuyMesho
      </p>
    </div>
  `;

  return {
    text: params.role === "buyer" ? buyerText : sellerText,
    html: params.role === "buyer" ? buyerHtml : sellerHtml,
  };
}
