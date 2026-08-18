import assert from 'node:assert/strict';
import test from 'node:test';
import { query } from '../../../postgres.js';
import { applyVerifiedPayChanguPayment } from '../paychangu.flow.js';
import { paymentRepository } from '../payment.repository.js';
import { orderRepository } from '../../orders/order.repository.js';
import { escrowRepository } from '../../escrow/escrow.repository.js';

const orderId='atomic-settlement-order-1';
const paymentReference='atomic-settlement-ref-1';

async function cleanup():Promise<void>{
  await query('DELETE FROM payouts WHERE order_id = $1',[orderId]);
  await query('DELETE FROM escrows WHERE order_id = $1',[orderId]);
  await query('DELETE FROM orders WHERE id = $1',[orderId]);
  await query('DELETE FROM payments WHERE reference = $1',[paymentReference]);
}

async function seedState():Promise<void>{
  await cleanup();
  const now=new Date().toISOString();
  await orderRepository.saveAsync({
    id:orderId,buyerId:'atomic-buyer-1',sellerId:'atomic-seller-1',source:'listing',status:'pending_payment',deliveryStatus:'action_required',
    currency:'MWK',subtotal:{amount:1000,currency:'MWK'},total:{amount:1000,currency:'MWK'},
    items:[{listingId:'atomic-listing-1',title:'Atomic Test Item',quantity:1,unitPrice:{amount:1000,currency:'MWK'}}],
    createdAt:now,updatedAt:now,paymentProvider:'paychangu',paymentReference,settlementRoute:'escrow',escrowId:null,buyerDetails:null,paidAt:null,fulfilledAt:null,
  });
  await paymentRepository.saveAsync({
    id:'atomic-payment-1',orderId,provider:'paychangu',method:'mobile_money',status:'pending',amount:{amount:1000,currency:'MWK'},reference:paymentReference,
    providerReference:null,checkoutUrl:null,paidAt:null,rawResponse:{},verified:false,createdAt:now,updatedAt:now,
  });
}

function verification(){return{verified:true,provider:'paychangu' as const,status:'success',reference:paymentReference,txRef:paymentReference,amount:{amount:1000,currency:'MWK'},currency:'MWK'} as const;}

test('verified payment settlement rolls back payment/order/escrow changes together',async()=>{
  await seedState();
  const originalCreateAsync=escrowRepository.createAsync;
  escrowRepository.createAsync=async()=>{throw new Error('simulated escrow failure');};
  try{
    await assert.rejects(()=>applyVerifiedPayChanguPayment(verification()),/simulated escrow failure/);
    assert.equal((await paymentRepository.findByReferenceAsync(paymentReference))?.status,'pending');
    assert.equal((await paymentRepository.findByReferenceAsync(paymentReference))?.verified,false);
    assert.equal((await orderRepository.findByIdAsync(orderId))?.status,'pending_payment');
    assert.equal(await escrowRepository.findByOrderIdAsync(orderId),undefined);
  }finally{
    escrowRepository.createAsync=originalCreateAsync;
    await cleanup();
  }
});

test('missing order does not mark payment captured and remains recoverable',async()=>{
  await cleanup();
  const now=new Date().toISOString();
  await paymentRepository.saveAsync({
    id:'atomic-payment-missing-order-1',orderId:'order-that-is-not-yet-visible',provider:'paychangu',method:'mobile_money',status:'pending',
    amount:{amount:1000,currency:'MWK'},reference:paymentReference,providerReference:null,checkoutUrl:null,paidAt:null,rawResponse:{},verified:false,createdAt:now,updatedAt:now,
  });
  try{
    const result=await applyVerifiedPayChanguPayment(verification());
    assert.equal(result.order,undefined);
    assert.equal(result.payment?.status,'pending');
    assert.equal(result.payment?.verified,false);
  }finally{await cleanup();}
});
