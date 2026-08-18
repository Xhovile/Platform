export const PAYMENT_ENDPOINTS = {
  paychangu: {
    initialize: '/api/payments/paychangu/initialize',
    verify: '/api/payments/paychangu/verify/:txRef',
    webhook: '/api/payments/paychangu/webhook',
    payoutWebhook: '/api/payments/paychangu-payout/webhook',
  },
} as const;
