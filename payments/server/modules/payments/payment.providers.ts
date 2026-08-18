import { PaymentGatewayRegistry } from '../../../src/modules/payments/paymentGateway.js';
import { flutterwaveProvider } from '../../../src/modules/payments/providers/flutterwave.js';
import { paychanguProvider } from '../../../src/modules/payments/providers/paychangu.js';
import { paystackProvider } from '../../../src/modules/payments/providers/paystack.js';

export function createPaymentProviderRegistry(): PaymentGatewayRegistry {
  const registry = new PaymentGatewayRegistry();
  registry.register(paystackProvider);
  registry.register(flutterwaveProvider);
  registry.register(paychanguProvider);
  return registry;
}
