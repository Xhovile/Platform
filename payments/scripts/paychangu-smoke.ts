// Developer sandbox harness only. Do not treat this smoke flow as a production-readiness check.
import { runPayChanguFlowHarness } from '../server/modules/payments/paychangu.harness';

async function main() {
  const txRef = process.argv[2] ?? 'PAYCHANGU_DEMO_TX_REF';

  const result = await runPayChanguFlowHarness(txRef);

  const summary = {
    orderBefore: {
      id: result.orderBefore.id,
      status: result.orderBefore.status,
      paymentReference: result.orderBefore.paymentReference,
    },
    payment: {
      reference: result.payment.reference,
      checkoutUrl: result.payment.checkoutUrl,
      status: result.payment.status,
    },
    verification: {
      verified: result.verification.verified,
      reference: result.verification.reference,
      status: result.verification.status,
    },
    applied: {
      paymentStatus: result.applied.payment?.status,
      orderStatus: result.applied.order?.status,
    },
    orderAfter: result.orderAfter
      ? {
          id: result.orderAfter.id,
          status: result.orderAfter.status,
          paymentReference: result.orderAfter.paymentReference,
        }
      : null,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('PayChangu smoke test failed:');
  console.error(error);
  process.exitCode = 1;
});
