import './payout.schema.js';
import { randomUUID } from 'crypto';
import { getPaymentDb } from '../../postgresCompat.js';
import { query, withTransaction } from '../../postgres.js';
import type { PoolClient } from 'pg';
import { buildPayChanguPayoutChargeId } from './payout.charge-id.js';
import type { PayChanguPayoutExecutionResult } from './paychangu.payout.js';
import { PAYOUT_POLICY, isRetryableFailureCode } from './payout.policy.js';
import { PayoutStatusRepository } from './payout.status-repository.js';
import {
  decryptSensitiveValue,
  exactProviderErrorMessage,
  providerFailureReason,
  type AdminOverrideAction,
  type CreateConnectPayoutInput,
  type CreateEligiblePayoutInput,
  type PayoutAttemptRecord,
  type PayoutRecord,
  type PayoutStatus,
  type ReconcileProviderCallbackInput,
  type PayoutNextAction,
} from './payout.shared.js';

type DbExecutor = Pick<PoolClient, 'query'>;

export class PayoutRepository {
  private readonly statusRepository: PayoutStatusRepository;

  constructor() {
    this.statusRepository = new PayoutStatusRepository((id) => this.findById(id));
  }

  private get db() {
    return getPaymentDb();
  }

  findByEscrowId(escrowId: string): PayoutRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM payouts WHERE escrow_id = ? AND release_entry_id IS NOT NULL ORDER BY created_at ASC LIMIT 1`).get(escrowId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToPayout(row);
  }

  findConnectPayoutByOrderId(orderId: string): PayoutRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM payouts WHERE order_id = ? AND escrow_id IS NULL ORDER BY created_at ASC LIMIT 1`).get(orderId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToPayout(row);
  }

  findAllByOrderOrEscrow(input: { orderId: string; escrowId: string }): PayoutRecord[] {
    const rows = this.db.prepare(`SELECT * FROM payouts WHERE order_id = @order_id OR escrow_id = @escrow_id ORDER BY created_at ASC`).all({ order_id: input.orderId, escrow_id: input.escrowId }) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToPayout(row));
  }

  findById(id: string): PayoutRecord | undefined {
    const row = this.db.prepare('SELECT * FROM payouts WHERE id = ? LIMIT 1').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToPayout(row);
  }

  findConnectByOrderId(orderId: string): PayoutRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM payouts WHERE order_id = ? AND escrow_id IS NULL ORDER BY created_at ASC LIMIT 1`).get(orderId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToPayout(row);
  }

  findLatestAttemptByPayoutId(payoutId: string): Record<string, unknown> | undefined {
    const row = this.db.prepare(`SELECT * FROM payout_attempts WHERE payout_id = ? ORDER BY attempt_no DESC, created_at DESC LIMIT 1`).get(payoutId) as Record<string, unknown> | undefined;
    return row ?? undefined;
  }

  async createEligibleForReleaseAsync(input: CreateEligiblePayoutInput, executor?: DbExecutor): Promise<PayoutRecord> {
    const run = async (client: DbExecutor): Promise<PayoutRecord> => {
      const existing = await this.findByEscrowIdAsync(input.escrowId, client);
      if (existing) return existing;
      const now = input.requestedAt ?? new Date().toISOString();
      const id = randomUUID();
      await client.query(
        `INSERT INTO payouts (
           id, seller_id, order_id, escrow_id, release_entry_id, destination_account_id,
           amount, gross_amount, platform_fee_amount, processing_fee_amount, reserve_amount,
           reserve_cap_amount, manual_adjustment_amount, payout_fee_amount, seller_receives_amount,
           net_amount, formula_snapshot, currency, status, provider, provider_charge_id,
           requested_by, requested_at, raw_request, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending_settlement','paychangu',NULL,$19,$20,$21,$22,$23)
         ON CONFLICT(id) DO NOTHING`,
        [
          id, input.sellerId, input.orderId, input.escrowId, input.releaseEntryId, input.destinationAccountId ?? null,
          input.amount, input.grossAmount, input.platformFeeAmount, input.processingFeeAmount, input.reserveAmount,
          input.reserveCapAmount, input.manualAdjustmentAmount, input.payoutFeeAmount ?? 0,
          input.sellerReceivesAmount ?? input.netAmount, input.netAmount, JSON.stringify(input.formulaSnapshot), input.currency,
          input.requestedBy, now, input.snapshot ? JSON.stringify(input.snapshot) : null, now, now,
        ],
      );
      const created = await this.findByEscrowIdAsync(input.escrowId, client);
      if (!created) throw new Error('Failed to create payout candidate');
      return created;
    };
    return executor ? run(executor) : withTransaction(run);
  }

  async findByEscrowIdAsync(escrowId: string, executor: DbExecutor = { query }): Promise<PayoutRecord | undefined> {
    const result = await executor.query<Record<string, unknown>>(
      `SELECT * FROM payouts WHERE escrow_id = $1 AND release_entry_id IS NOT NULL ORDER BY created_at ASC LIMIT 1`,
      [escrowId],
    );
    return result.rows[0] ? this.rowToPayout(result.rows[0]) : undefined;
  }

  async addEventAsync(input: {
    payoutId: string;
    sellerId: string;
    eventType: string;
    actorType: string;
    actorId?: string | null;
    note?: string | null;
    payload?: Record<string, unknown> | null;
  }, executor?: DbExecutor): Promise<void> {
    const run = (client: DbExecutor) => client.query(
      `INSERT INTO payout_events (payout_id,seller_id,event_type,actor_type,actor_id,note,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.payoutId, input.sellerId, input.eventType, input.actorType, input.actorId ?? null, input.note ?? null, input.payload ? JSON.stringify(input.payload) : null, new Date().toISOString()],
    ).then(() => undefined);
    if (executor) await run(executor); else await withTransaction(run);
  }

  // Existing synchronous methods remain temporarily for callers not yet migrated.
  ensureLegacyAttemptForReconciliation(input: { payoutId: string; actorType: 'admin' | 'system'; actorId?: string | null }): { created: boolean; providerReference: string | null } {
    const existingAttempt = this.findLatestAttemptByPayoutId(input.payoutId);
    if (existingAttempt) {
      const providerReference = (existingAttempt.provider_charge_id as string | null) ?? (existingAttempt.provider_ref_id as string | null) ?? (existingAttempt.provider_transaction_id as string | null) ?? null;
      return { created: false, providerReference };
    }
    const payout = this.db.prepare(`SELECT id, seller_id AS sellerId, provider, provider_charge_id AS providerChargeId, provider_ref_id AS providerRefId, provider_transaction_id AS providerTransactionId FROM payouts WHERE id = ? LIMIT 1`).get(input.payoutId) as { id:string;sellerId:string;provider:string|null;providerChargeId:string|null;providerRefId:string|null;providerTransactionId:string|null } | undefined;
    if (!payout) throw new Error('Payout not found');
    const providerReference = payout.providerChargeId ?? payout.providerRefId ?? payout.providerTransactionId ?? null;
    if (!providerReference) return { created: false, providerReference: null };
    const now = new Date().toISOString(); const attemptId = randomUUID();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO payout_attempts (id,payout_id,attempt_no,provider,provider_charge_id,request_payload,response_payload,status,failure_reason,sent_at,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(attemptId,input.payoutId,1,payout.provider ?? 'paychangu',providerReference,JSON.stringify({legacyBackfill:true,payoutId:input.payoutId,source:'legacy_reconciliation_fallback'}),null,'legacy_imported',null,now,now,now,now);
      this.db.prepare(`UPDATE payouts SET provider=COALESCE(provider,?),provider_charge_id=COALESCE(provider_charge_id,?),provider_ref_id=COALESCE(provider_ref_id,?),updated_at=? WHERE id=?`).run(payout.provider ?? 'paychangu',providerReference,providerReference,now,input.payoutId);
      this.addEvent({payoutId:input.payoutId,sellerId:payout.sellerId,eventType:'payout_legacy_attempt_backfilled',actorType:input.actorType,actorId:input.actorId ?? null,note:'Synthetic provider attempt created for legacy reconciliation',payload:{providerReference,backfilledAt:now}});
    })();
    return { created: true, providerReference };
  }

  createEligibleForRelease(input: CreateEligiblePayoutInput): PayoutRecord {
    const existing = this.findByEscrowId(input.escrowId); if (existing) return existing;
    const now = input.requestedAt ?? new Date().toISOString(); const id = randomUUID();
    this.db.prepare(`INSERT INTO payouts (id,seller_id,order_id,escrow_id,release_entry_id,destination_account_id,amount,gross_amount,platform_fee_amount,processing_fee_amount,reserve_amount,reserve_cap_amount,manual_adjustment_amount,payout_fee_amount,seller_receives_amount,net_amount,formula_snapshot,currency,status,provider,provider_charge_id,requested_by,requested_at,raw_request,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending_settlement','paychangu',NULL,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).run(id,input.sellerId,input.orderId,input.escrowId,input.releaseEntryId,input.destinationAccountId ?? null,input.amount,input.grossAmount,input.platformFeeAmount,input.processingFeeAmount,input.reserveAmount,input.reserveCapAmount,input.manualAdjustmentAmount,input.payoutFeeAmount ?? 0,input.sellerReceivesAmount ?? input.netAmount,input.netAmount,JSON.stringify(input.formulaSnapshot),input.currency,input.requestedBy,now,input.snapshot ? JSON.stringify(input.snapshot) : null,now,now);
    const created=this.findByEscrowId(input.escrowId); if(!created)throw new Error('Failed to create payout candidate'); return created;
  }

  createConnectPayoutCandidate(input: CreateConnectPayoutInput): { payout: PayoutRecord; created: boolean } {
    const existing=this.findConnectByOrderId(input.orderId); if(existing)return {payout:existing,created:false};
    const now=input.requestedAt ?? new Date().toISOString(),id=randomUUID();
    this.db.prepare(`INSERT INTO payouts (id,seller_id,order_id,escrow_id,release_entry_id,destination_account_id,amount,gross_amount,platform_fee_amount,processing_fee_amount,reserve_amount,reserve_cap_amount,manual_adjustment_amount,payout_fee_amount,seller_receives_amount,net_amount,formula_snapshot,currency,status,provider,provider_charge_id,requested_by,requested_at,raw_request,created_at,updated_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_settlement','paychangu',NULL, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).run(id,input.sellerId,input.orderId,input.destinationAccountId ?? null,input.amount,input.grossAmount,input.platformFeeAmount,input.processingFeeAmount,input.reserveAmount,input.reserveCapAmount,input.manualAdjustmentAmount,input.payoutFeeAmount ?? 0,input.sellerReceivesAmount ?? input.netAmount,input.netAmount,JSON.stringify(input.formulaSnapshot),input.currency,input.requestedBy,now,input.snapshot ? JSON.stringify(input.snapshot) : null,now,now);
    const payout=this.findConnectByOrderId(input.orderId); if(!payout)throw new Error('Failed to create Connect payout candidate'); return {payout,created:payout.id===id};
  }

  updateStatus(id:string,status:PayoutStatus,extra:Record<string,unknown>={}):PayoutRecord|undefined{return this.statusRepository.updateStatus(id,status,extra);}
  updateExecutionState(payoutId:string,execution:PayChanguPayoutExecutionResult):PayoutRecord|undefined{const statusExtras:Record<string,unknown>={provider:execution.provider,providerChargeId:execution.providerChargeId,providerReference:execution.providerReference,providerTransactionId:execution.providerTransactionId,providerStatus:execution.status};if(execution.status==='paid')statusExtras.paidAt=new Date().toISOString();if(execution.status==='failed'){statusExtras.failedAt=new Date().toISOString();statusExtras.failureReason=execution.failureClass ?? 'provider_execution_failed';const exactMessage=exactProviderErrorMessage(execution.rawResponse);statusExtras.manualReviewReason=execution.failureClass?providerFailureReason(execution.failureClass,exactMessage):exactMessage ?? 'Provider reported payout failure';}return this.updateStatus(payoutId,execution.status,statusExtras);}
  nextAttemptNo(payoutId:string):number{const row=this.db.prepare(`SELECT COALESCE(MAX(attempt_no),0) AS max_attempt_no FROM payout_attempts WHERE payout_id=?`).get(payoutId) as {max_attempt_no?:number}|undefined;return Number(row?.max_attempt_no??0)+1;}
  recordAttempt(id:string,payoutId:string,execution:PayChanguPayoutExecutionResult):void{const createdAt=new Date().toISOString();const failedReason=execution.status==='failed'?execution.failureClass ?? 'provider_execution_failed':null;this.db.prepare(`UPDATE payout_attempts SET provider=?,provider_charge_id=?,request_payload=?,response_payload=?,status=?,failure_reason=?,sent_at=?,completed_at=?,updated_at=? WHERE id=?`).run(execution.provider,execution.providerChargeId,JSON.stringify({payoutId:execution.payoutId,providerReference:execution.providerReference,providerTransactionId:execution.providerTransactionId,providerChargeId:execution.providerChargeId,attemptNo:execution.attemptNo,request:execution.rawResponse?.request ?? null}),JSON.stringify(execution.rawResponse ?? {}),execution.status,failedReason,createdAt,createdAt,createdAt,id);}
  reserveRetryAttempt(input:{payoutId:string;provider:string;actorType:'admin'|'system';actorId?:string|null}):{id:string;attemptNo:number;providerChargeId:string;createdAt:string}{this.db.prepare('BEGIN IMMEDIATE TRANSACTION').run();try{const attemptNo=this.nextAttemptNo(input.payoutId),providerChargeId=buildPayChanguPayoutChargeId(input.payoutId,attemptNo),id=randomUUID(),now=new Date().toISOString();this.updateStatus(input.payoutId,'processing',{provider:input.provider,providerChargeId,providerStatus:'processing',approvedBy:input.actorType==='admin'?input.actorId ?? null:null,sentAt:now});this.db.prepare(`INSERT INTO payout_attempts (id,payout_id,attempt_no,provider,provider_charge_id,request_payload,response_payload,status,sent_at,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,input.payoutId,attemptNo,input.provider,providerChargeId,JSON.stringify({payoutId:input.payoutId,attemptNo}),null,'processing',now,null,now,now);this.db.prepare('COMMIT').run();return{id,attemptNo,providerChargeId,createdAt:now};}catch(error){this.db.prepare('ROLLBACK').run();throw error;}}
  addEvent(input:{payoutId:string;sellerId:string;eventType:string;actorType:string;actorId?:string|null;note?:string|null;payload?:Record<string,unknown>|null}):void{this.db.prepare(`INSERT INTO payout_events (payout_id,seller_id,event_type,actor_type,actor_id,note,payload,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(input.payoutId,input.sellerId,input.eventType,input.actorType,input.actorId ?? null,input.note ?? null,input.payload ? JSON.stringify(input.payload):null,new Date().toISOString());}
  private rowToPayout(row:Record<string,unknown>):PayoutRecord{return{id:row.id as string,sellerId:row.seller_id as string,orderId:(row.order_id as string|null)??null,escrowId:(row.escrow_id as string|null)??null,releaseEntryId:(row.release_entry_id as string|null)??null,destinationAccountId:(row.destination_account_id as string|null)??null,amount:row.amount as number,currency:row.currency as string,status:row.status as PayoutStatus,provider:(row.provider as string|null)??null,providerChargeId:(row.provider_charge_id as string|null)??null,providerStatus:(row.provider_status as string|null)??null,requestedBy:(row.requested_by as string|null)??null,requestedAt:(row.requested_at as string|null)??null,createdAt:row.created_at as string,updatedAt:row.updated_at as string};}
}
export const payoutRepository=new PayoutRepository();
