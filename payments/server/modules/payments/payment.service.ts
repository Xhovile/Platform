import type { CreatePaymentRequest, PaymentResult, PaymentVerificationResult, RefundRequest, RefundResult, WebhookVerificationResult } from '../../../src/modules/payments/types.js';
import { ApiError } from '../../../src/shared/api/errors.js';
import { PaymentGatewayRegistry } from '../../../src/modules/payments/paymentGateway.js';
import { flutterwaveProvider } from '../../../src/modules/payments/providers/flutterwave.js';
import { paystackProvider } from '../../../src/modules/payments/providers/paystack.js';
import { paychanguProvider } from './paychangu.provider.js';
import { paymentRepository } from './payment.repository.js';
import { orderRepository } from '../orders/order.repository.js';
import { applyVerifiedPayChanguPayment } from './paychangu.flow.js';
import { findPendingPayChanguWebhook } from '../../postgresCompat/webhooks.js';
import dotenv from 'dotenv';
dotenv.config();

export interface ServerPaymentConfig { paychanguEnabled?: boolean; paychanguSecretKey?: string; paychanguWebhookSecret?: string; paychanguBaseUrl?: string; }
const REFUND_UNAVAILABLE_MESSAGE='Refunds are not available yet for this payment provider';
function readEnv(name:string):string|undefined{const value=process.env[name]?.trim();return value?value:undefined;}
function isTruthyFlag(value:string|undefined):boolean{return value==='1'||value==='true'||value==='yes'||value==='on';}
function validatePayChanguConfig(config:ServerPaymentConfig):void{if(!config.paychanguEnabled||process.env.NODE_ENV!=='production')return;const missing:string[]=[];if(!config.paychanguSecretKey)missing.push('PAYCHANGU_SECRET_KEY');if(!config.paychanguWebhookSecret)missing.push('PAYCHANGU_WEBHOOK_SECRET');if(missing.length)throw new Error(`Missing required PayChangu environment variables in production: ${missing.join(', ')}`);}
function normalizeCurrency(value:string|undefined):string{return String(value??'').trim().toUpperCase();}
function paymentMatchesExpectedTotal(expected:{amount:number;currency:string},actual?:{amount:number;currency:string}):boolean{return Boolean(actual&&actual.amount===expected.amount&&normalizeCurrency(expected.currency)===normalizeCurrency(actual.currency));}
export function createServerPaymentConfigFromEnv():ServerPaymentConfig{const paychanguSecretKey=readEnv('PAYCHANGU_SECRET_KEY'),paychanguWebhookSecret=readEnv('PAYCHANGU_WEBHOOK_SECRET'),paychanguBaseUrl=readEnv('PAYCHANGU_BASE_URL');return{paychanguEnabled:isTruthyFlag(readEnv('PAYCHANGU_ENABLED'))||Boolean(paychanguSecretKey)||Boolean(paychanguWebhookSecret)||Boolean(paychanguBaseUrl),paychanguSecretKey,paychanguWebhookSecret,paychanguBaseUrl};}

export class ServerPaymentService{
  constructor(private readonly config:ServerPaymentConfig={},private readonly registry=ServerPaymentService.createDefaultRegistry()){validatePayChanguConfig(config);}
  private resolveConfig():ServerPaymentConfig{const envPayChanguSecretKey=readEnv('PAYCHANGU_SECRET_KEY'),envPayChanguWebhookSecret=readEnv('PAYCHANGU_WEBHOOK_SECRET'),envPayChanguBaseUrl=readEnv('PAYCHANGU_BASE_URL');return{paychanguSecretKey:envPayChanguSecretKey??this.config.paychanguSecretKey,paychanguWebhookSecret:envPayChanguWebhookSecret??this.config.paychanguWebhookSecret,paychanguBaseUrl:envPayChanguBaseUrl??this.config.paychanguBaseUrl};}
  static createDefaultRegistry():PaymentGatewayRegistry{const registry=new PaymentGatewayRegistry();registry.register(paystackProvider);registry.register(flutterwaveProvider);registry.register(paychanguProvider);return registry;}

  async createPayment(request:CreatePaymentRequest):Promise<PaymentResult>{const result=request.provider==='paychangu'?await paychanguProvider.createPayment(request,this.resolveConfig()):await this.registry.get(request.provider).createPayment(request);const saved=await paymentRepository.saveAsync({...result,verified:false});if(result.provider==='paychangu'&&findPendingPayChanguWebhook(result.reference)){try{await this.verifyPaychanguPayment(result.reference);}catch{/* stored webhook remains retryable */}}return saved;}

  async verifyPaychanguPayment(txRef:string):Promise<PaymentVerificationResult>{const requestedTxRef=txRef.trim();const verification=await paychanguProvider.verifyPayment(requestedTxRef,this.resolveConfig());const returnedReference=verification.reference?.trim()||requestedTxRef;const payment=await paymentRepository.findByReferenceAsync(requestedTxRef);let strictVerified=verification.verified;let failureReason=verification.failureReason;
    if(returnedReference!==requestedTxRef){strictVerified=false;failureReason=failureReason??'Verified transaction reference does not match requested transaction reference';}
    if(!payment){strictVerified=false;failureReason=failureReason??'Stored payment record not found for this reference';}
    else if(payment.reference!==requestedTxRef){strictVerified=false;failureReason=failureReason??'Stored payment reference does not match requested transaction reference';}
    else{const order=await orderRepository.findByIdAsync(payment.orderId);if(!order){strictVerified=false;failureReason=failureReason??'Associated order not found';}else if(order.paymentReference&&order.paymentReference!==requestedTxRef){strictVerified=false;failureReason=failureReason??'Order payment reference does not match requested transaction reference';}else if(!paymentMatchesExpectedTotal(order.total,verification.amount)){strictVerified=false;failureReason=failureReason??`Payment amount or currency does not exactly match order total for ${order.id}`;}}
    const strictVerification:PaymentVerificationResult={...verification,verified:strictVerified,orderId:payment?.orderId,failureReason};
    if(payment)await paymentRepository.updateByReferenceAsync(payment.reference,current=>({...current,verified:strictVerification.verified,verification:strictVerification}));
    if(strictVerification.verified&&payment){const currentOrder=await orderRepository.findByIdAsync(payment.orderId);if(currentOrder&&!['in_escrow','fulfilled','refunded','closed','disputed'].includes(currentOrder.status)){await applyVerifiedPayChanguPayment({...strictVerification,provider:'paychangu',reference:requestedTxRef,txRef:requestedTxRef,status:strictVerification.status??'captured'});}}
    return strictVerification;
  }

  async refund(request:RefundRequest):Promise<RefundResult>{const provider=this.registry.get(request.provider);if(!provider.capabilities.supportsRefunds)throw new ApiError(REFUND_UNAVAILABLE_MESSAGE,{message:REFUND_UNAVAILABLE_MESSAGE,code:'REFUNDS_UNAVAILABLE',status:501});return provider.refund(request);}
  async verifyWebhook(providerKey:Parameters<PaymentGatewayRegistry['get']>[0],signature:string|undefined,payload:string|Record<string,unknown>):Promise<WebhookVerificationResult>{return providerKey==='paychangu'?paychanguProvider.verifyWebhook(signature,payload,this.resolveConfig()):this.registry.get(providerKey).verifyWebhook(signature,payload);}
  async parseWebhook(providerKey:Parameters<PaymentGatewayRegistry['get']>[0],payload:unknown):Promise<WebhookVerificationResult>{return providerKey==='paychangu'?paychanguProvider.parseWebhook(payload):this.registry.get(providerKey).parseWebhook(payload);}
}

export const serverPaymentService=new ServerPaymentService({paychanguSecretKey:process.env.PAYCHANGU_SECRET_KEY,paychanguWebhookSecret:process.env.PAYCHANGU_WEBHOOK_SECRET,paychanguBaseUrl:process.env.PAYCHANGU_BASE_URL});
