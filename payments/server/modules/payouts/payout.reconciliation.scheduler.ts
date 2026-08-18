import { getPaymentDb } from '../../postgresCompat.js';
import { payoutRepository, payoutService } from './payout.service.js';

export type PayoutReconciliationSchedulerConfig = {
  enabled: boolean;
  intervalMs: number;
  batchLimit: number;
};

type ReconcilePayouts = (input: {
  actorType: 'system';
  limit: number;
}) => Promise<unknown>;

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 25;
const MIN_INTERVAL_MS = 10_000;
const MAX_BATCH_LIMIT = 50;

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parsePositiveIntegerEnv(
  value: string | undefined,
  defaultValue: number,
  options: { min?: number; max?: number } = {},
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  const integer = Math.trunc(parsed);
  if (integer <= 0) {
    return defaultValue;
  }

  const min = options.min ?? integer;
  const max = options.max ?? Math.max(integer, min);
  return Math.min(Math.max(integer, min), max);
}

function isPastSettlementMidnightTPlusOne(referenceAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!referenceAt) {
    return false;
  }

  const referenceDate = new Date(referenceAt);
  const timestamp = referenceDate.getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const catFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Blantyre',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const parts = catFormatter.formatToParts(referenceDate);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }

  const settlementAt = Date.UTC(year, month - 1, day + 1, 6, 0, 0, 0);

  return nowMs >= settlementAt;
}

export function getPayoutReconciliationSchedulerConfig(
  env: NodeJS.ProcessEnv = process.env,
): PayoutReconciliationSchedulerConfig {
  return {
    enabled: parseBooleanEnv(env.PAYOUT_RECONCILIATION_WORKER_ENABLED, true),
    intervalMs: parsePositiveIntegerEnv(env.PAYOUT_RECONCILIATION_WORKER_INTERVAL_MS, DEFAULT_INTERVAL_MS, {
      min: MIN_INTERVAL_MS,
    }),
    batchLimit: parsePositiveIntegerEnv(env.PAYOUT_RECONCILIATION_WORKER_BATCH_LIMIT, DEFAULT_BATCH_LIMIT, {
      max: MAX_BATCH_LIMIT,
    }),
  };
}

export class PayoutReconciliationScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly config: PayoutReconciliationSchedulerConfig,
    private readonly reconcile: ReconcilePayouts = (input) => payoutService.reconcilePendingPayoutStatuses(input),
    private readonly logger: Logger = console,
  ) {}

  start(): void {
    if (!this.config.enabled) {
      this.logger.log('[payout-reconciliation] worker disabled');
      return;
    }

    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.intervalMs);

    this.timer.unref?.();
    this.logger.log(
      `[payout-reconciliation] worker started intervalMs=${this.config.intervalMs} batchLimit=${this.config.batchLimit}`,
    );
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async settlePendingSettlementPayouts(limit: number): Promise<number> {
    const db = getPaymentDb();
    const rows = db.prepare(
      `SELECT id, seller_id, requested_at, created_at
       FROM payouts
       WHERE status = 'pending_settlement'
       ORDER BY COALESCE(requested_at, created_at) ASC
       LIMIT ?`,
    ).all(limit) as Array<{
      id: string;
      seller_id: string;
      requested_at: string | null;
      created_at: string;
    }>;

    let settledCount = 0;

    for (const row of rows) {
      const referenceAt = row.requested_at ?? row.created_at;
      if (!isPastSettlementMidnightTPlusOne(referenceAt)) {
        continue;
      }

      const ready = payoutRepository.updateStatus(row.id, 'ready_for_payout', {
        provider: 'paychangu',
        providerStatus: 'ready_for_payout',
      });

      if (!ready) {
        continue;
      }

      payoutRepository.addEvent({
        payoutId: row.id,
        sellerId: row.seller_id,
        eventType: 'payout_ready_for_payout',
        actorType: 'system',
        actorId: null,
        note: 'Settlement window elapsed; payout is ready for submission',
        payload: {
          referenceAt,
          settledAt: new Date().toISOString(),
        },
      });

      const queued = payoutRepository.updateStatus(row.id, 'queued', {
        provider: 'paychangu',
        providerStatus: 'queued',
      });

      if (!queued) {
        continue;
      }

      payoutRepository.addEvent({
        payoutId: row.id,
        sellerId: row.seller_id,
        eventType: 'payout_queued',
        actorType: 'system',
        actorId: null,
        note: 'Payout queued for provider submission after settlement',
      });

      await payoutService.executePayout({
        payoutId: row.id,
        actorType: 'system',
      });

      settledCount += 1;
    }

    return settledCount;
  }

  async runOnce(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    if (this.running) {
      this.logger.warn('[payout-reconciliation] previous run still active; skipping overlap');
      return;
    }

    this.running = true;
    try {
      const settledCount = await this.settlePendingSettlementPayouts(this.config.batchLimit);
      if (settledCount > 0) {
        this.logger.log(`[payout-reconciliation] settlement worker released ${settledCount} payout(s)`);
      }

      await this.reconcile({ actorType: 'system', limit: this.config.batchLimit });
    } catch (error) {
      this.logger.error('[payout-reconciliation] reconcile failed:', error);
    } finally {
      this.running = false;
    }
  }
}

export function startPayoutReconciliationScheduler(
  config = getPayoutReconciliationSchedulerConfig(),
): PayoutReconciliationScheduler {
  const scheduler = new PayoutReconciliationScheduler(config);
  scheduler.start();
  return scheduler;
}
