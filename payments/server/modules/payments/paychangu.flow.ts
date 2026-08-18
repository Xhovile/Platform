import type { PaymentResult, PaymentVerificationResult } from '../../../src/modules/payments/types.js';
import '../payouts/payout.schema.js';
import { paymentRepository } from './payment.repository.js';
import { orderRepository } from '../orders/order.repository.js';
import { serverOrderService } from '../orders/order.service.js';
import { escrowRepository } from '../escrow/escrow.repository.js';
import { payoutRepository, payoutService } from '../payouts/payout.service.js';
import { getConnectAccount } from '../connect/connect.service.js';
import { calculatePayoutFormula } from '../payouts/payout.policy.js';
import { withTransaction } from '../../postgres.js';
import type { PoolClient } from 'pg';
import { getPaymentDb } from '../../postgresCompat.js';
import { isPaychanguSuccessStatus } from './paychangu.provider.js';
import { notifyOrderPaid } from '../notifications/order-paid.notification.js';

export interface ApplyPayChanguResult {
  payment?: ReturnType<typeof paymentRepository.findByReference>;
  order?: ReturnType<typeof orderRepository.findByPaymentReference>;
  verification: PaymentVerificationResult;
}

interface SellerPayoutDestination { id:string; destination_type?:string|null; provider_ref_id?:string|null; provider_name?:string|null; }
type ConnectPayoutMethod = 'airtel_money'|'tnm_mpamba'|'bank_transfer'|null;
type DbExecutor = Pick<PoolClient,'query'>;

function normalizeReference(value:string|undefined|null):string{return String(value??'').trim();}
function stripPayChanguPrefix(value:string):string{return value.replace(/^PAYCHANGU-/i,'');}
function uniqueReferences(values:Array<string|undefined|null>):string[]{const seen=new Set<string>();const out:string[]=[];for(const value of values){const reference=normalizeReference(value);if(!reference||seen.has(reference))continue;seen.add(reference);out.push(reference);}return out;}
function resolveReferenceCandidates(verification:PaymentVerificationResult):string[]{const exact=uniqueReferences([verification.reference,verification.txRef]);return uniqueReferences([...exact,...exact.map(stripPayChanguPrefix)]);}
export function buildPayChanguPayoutChargeId(payoutId:string,attemptNo:number):string{const safe=Number.isFinite(attemptNo)&&attemptNo>0?Math.trunc(attemptNo):1;return `BM-PO-${payoutId}-A${String(safe).padStart(2,'0')}`;}
function emitSellerPayoutQueuedNotification(sellerId:string,orderId:string,payoutId:string):void{console.log('[notification] seller_payout_queued',JSON.stringify({orderId,payoutId,sellerId,event:'seller_payout_queued',emittedAt:new Date().toISOString()}));}
function emitOrderPaidNotification(order:ReturnType<typeof orderRepository.findByPaymentReference>):void{if(!order)return;void notifyOrderPaid(order).catch(error=>console.warn('[notification] order_paid email delivery failed',error));}
function findActiveVerifiedDestination(sellerId:string):{id:string;destination_type:string|null}|undefined{return getPaymentDb().prepare(`SELECT id,destination_type FROM seller_payout_accounts WHERE seller_uid=? AND is_active=1 AND verification_status='verified' ORDER BY is_default DESC,verified_at DESC,created_at DESC LIMIT 1`).get(sellerId) as {id:string;destination_type:string|null}|undefined;}
function normalizePayoutMethod(destinationType:string|null|undefined):Parameters<typeof calculatePayoutFormula>[0]['payoutMethod']{return destinationType==='airtel_money'||destinationType==='tnm_mpamba'||destinationType==='bank_transfer'?destinationType:null;}
function findSellerDefaultPayoutDestination(sellerId:string):SellerPayoutDestination|undefined{return getPaymentDb().prepare(`SELECT id,destination_type,provider_ref_id,provider_name FROM seller_payout_accounts WHERE seller_uid=? AND is_active=1 AND verification_status='verified' ORDER BY is_default DESC,updated_at DESC LIMIT 1`).get(sellerId) as unknown as SellerPayoutDestination|undefined;}
function derivePayoutMethod(destination:SellerPayoutDestination|undefined):ConnectPayoutMethod{if(destination?.destination_type==='bank')return'bank_transfer';const ref=`${destination?.provider_ref_id??''} ${destination?.provider_name??''}`;if(/tnm|mpamba/i.test(ref))return'tnm_mpamba';if(/airtel/i.test(ref))return'airtel_money';return null;}
function isCaptured(verification:PaymentVerificationResult):boolean{return Boolean(verification.verified&&isPaychanguSuccessStatus(String(verification.status??'')));}

async function resolveOrderByReferences(references:string[],executor:DbExecutor):Promise<ReturnType<typeof orderRepository.findByPaymentReference>>{for(const reference of references){const order=await orderRepository.findByPaymentReferenceAsync(reference,executor);if(order)return order;}return undefined;}
async function updatePaymentByReferences(references:string[],updater:Parameters<typeof paymentRepository.updateByReference>[1],executor:DbExecutor){for(const reference of references){const payment=await paymentRepository.updateByReferenceAsync(reference,updater,executor);if(payment)return payment;}return undefined;}
async function confirmOrderByReferences(references:string[],executor:DbExecutor){for(const reference of references){const order=await serverOrderService.confirmByPaymentReferenceAsync(reference,executor);if(order)return order;}return undefined;}

export async function applyVerifiedPayChanguPayment(verification:PaymentVerificationResult):Promise<ApplyPayChanguResult>{
  const referenceCandidates=resolveReferenceCandidates(verification);const reference=referenceCandidates[0];
  if(!reference)throw new Error('Missing PayChangu reference');
  if(!isCaptured(verification))throw new Error(`applyVerifiedPayChanguPayment only accepts verified paid/captured statuses for ${reference}`);

  const settlement=await withTransaction(async(client)=>{
    const order=await resolveOrderByReferences(referenceCandidates,client);
    if(!order){const payment= (await Promise.all(referenceCandidates.map(candidate=>paymentRepository.findByReferenceAsync(candidate,client)))).find(Boolean);return{payment,verification,sellerPayoutQueued:false,payoutId:null,orderEnteredEscrow:false,order:undefined};}
    if(['refunded','closed','disputed'].includes(order.status)){const payment=(await Promise.all(referenceCandidates.map(candidate=>paymentRepository.findByReferenceAsync(candidate,client)))).find(Boolean);return{payment,order,verification,sellerPayoutQueued:false,payoutId:null,orderEnteredEscrow:false};}

    const existingPayment=(await Promise.all(referenceCandidates.map(candidate=>paymentRepository.findByReferenceAsync(candidate,client)))).find(Boolean);
    if(existingPayment?.status==='refunded')return{payment:existingPayment,order,verification,sellerPayoutQueued:false,payoutId:null,orderEnteredEscrow:false};

    const payment=await updatePaymentByReferences(referenceCandidates,current=>({...current,verified:true,verification,status:'captured',paidAt:new Date().toISOString(),updatedAt:new Date().toISOString()}),client);
    const confirmedOrder=await confirmOrderByReferences(referenceCandidates,client);
    const activeOrder=confirmedOrder ?? await serverOrderService.setStatusAsync(order.id,'paid',client) ?? order;

    if(activeOrder.settlementRoute==='connect'){
      const connectAccount=getConnectAccount(activeOrder.sellerId);
      if(!connectAccount||connectAccount.status!=='connected')return{payment,order:activeOrder,verification,sellerPayoutQueued:false,payoutId:null,orderEnteredEscrow:false};
      const destination=findSellerDefaultPayoutDestination(activeOrder.sellerId);const payoutMethod=derivePayoutMethod(destination);const grossAmount=activeOrder.total.amount;const currency=normalizeReference(activeOrder.currency).toUpperCase();
      const payoutFormula=calculatePayoutFormula({grossAmount,currency,payoutMethod});
      const {payout,created}=payoutService.createConnectPayoutCandidate({sellerId:activeOrder.sellerId,orderId:activeOrder.id,amount:payoutFormula.sellerReceivesAmount,grossAmount:payoutFormula.grossAmount,platformFeeAmount:payoutFormula.platformFeeAmount,processingFeeAmount:payoutFormula.processingFeeAmount,reserveAmount:payoutFormula.reserveAmount,reserveCapAmount:payoutFormula.reserveCapAmount,manualAdjustmentAmount:payoutFormula.manualAdjustmentAmount,payoutFeeAmount:payoutFormula.payoutFeeAmount,sellerReceivesAmount:payoutFormula.sellerReceivesAmount,netAmount:payoutFormula.netAmount,formulaSnapshot:payoutFormula,currency,requestedBy:'system',destinationAccountId:destination?.id??null,snapshot:{payoutFormula,settlementRoute:activeOrder.settlementRoute,paymentReference:reference,payChanguVerificationReference:verification.reference??verification.txRef??null,connectAccountId:connectAccount.id,connectStatus:connectAccount.status,connectMode:connectAccount.mode}});
      if(created)payoutRepository.addEvent({payoutId:payout.id,sellerId:activeOrder.sellerId,eventType:'connect_payout_queued',actorType:'system',note:'Connect payment created seller payout candidate',payload:{settlementRoute:activeOrder.settlementRoute,payoutFormula,destinationAccountId:destination?.id??null,connectAccountId:connectAccount.id,connectStatus:connectAccount.status,connectMode:connectAccount.mode,payChanguVerificationReference:verification.reference??verification.txRef??null}});
      return{payment,order:activeOrder,verification,sellerPayoutQueued:created,payoutId:payout.id,orderEnteredEscrow:false};
    }

    const escrowAmount=activeOrder.total.amount;const currency=normalizeReference(activeOrder.currency).toUpperCase();
    const escrow=await escrowRepository.createAsync(activeOrder.id,currency,escrowAmount,client);
    const escrowedOrder=await serverOrderService.markInEscrowAsync(activeOrder.id,escrow.id,client) ?? activeOrder;
    return{payment,order:escrowedOrder,verification,sellerPayoutQueued:false,payoutId:null,orderEnteredEscrow:escrowedOrder.status==='in_escrow'&&order.status!=='in_escrow'};
  });

  if(settlement.sellerPayoutQueued&&settlement.payoutId&&settlement.order)emitSellerPayoutQueuedNotification(settlement.order.sellerId,settlement.order.id,settlement.payoutId);
  if(settlement.order){if(settlement.orderEnteredEscrow||settlement.order.status==='paid')emitOrderPaidNotification(settlement.order);}
  return{payment:settlement.payment,order:settlement.order,verification:settlement.verification};
}

export function seedDemoPayChanguPayment(payment:PaymentResult):ReturnType<typeof paymentRepository.save>{return paymentRepository.save({...payment,verified:false});}
