import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PayoutReconciliationScheduler,
  getPayoutReconciliationSchedulerConfig,
} from '../payout.reconciliation.scheduler.js';

type LogEntry = { level: 'log' | 'warn' | 'error'; args: unknown[] };

function createLogger(entries: LogEntry[]) {
  return {
    log: (...args: unknown[]) => entries.push({ level: 'log', args }),
    warn: (...args: unknown[]) => entries.push({ level: 'warn', args }),
    error: (...args: unknown[]) => entries.push({ level: 'error', args }),
  };
}

test('payout reconciliation scheduler reads bounded environment config', () => {
  const config = getPayoutReconciliationSchedulerConfig({
    PAYOUT_RECONCILIATION_WORKER_ENABLED: 'true',
    PAYOUT_RECONCILIATION_WORKER_INTERVAL_MS: '5000',
    PAYOUT_RECONCILIATION_WORKER_BATCH_LIMIT: '500',
  });

  assert.deepEqual(config, {
    enabled: true,
    intervalMs: 10_000,
    batchLimit: 50,
  });
});

test('payout reconciliation scheduler does not run when disabled', async () => {
  let calls = 0;
  const scheduler = new PayoutReconciliationScheduler(
    { enabled: false, intervalMs: 10_000, batchLimit: 10 },
    async () => {
      calls += 1;
    },
    createLogger([]),
  );

  await scheduler.runOnce();
  assert.equal(calls, 0);
});

test('payout reconciliation scheduler invokes service as system actor with configured limit', async () => {
  const inputs: unknown[] = [];
  const scheduler = new PayoutReconciliationScheduler(
    { enabled: true, intervalMs: 10_000, batchLimit: 7 },
    async (input) => {
      inputs.push(input);
    },
    createLogger([]),
  );

  await scheduler.runOnce();
  assert.deepEqual(inputs, [{ actorType: 'system', limit: 7 }]);
});

test('payout reconciliation scheduler catches and logs reconciliation errors', async () => {
  const logs: LogEntry[] = [];
  const scheduler = new PayoutReconciliationScheduler(
    { enabled: true, intervalMs: 10_000, batchLimit: 7 },
    async () => {
      throw new Error('provider unavailable');
    },
    createLogger(logs),
  );

  await scheduler.runOnce();
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.level, 'error');
  assert.match(String(logs[0]?.args[0]), /reconcile failed/);
});

test('payout reconciliation scheduler skips overlapping runs', async () => {
  const logs: LogEntry[] = [];
  let calls = 0;
  let release!: () => void;
  const firstRun = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scheduler = new PayoutReconciliationScheduler(
    { enabled: true, intervalMs: 10_000, batchLimit: 7 },
    async () => {
      calls += 1;
      await firstRun;
    },
    createLogger(logs),
  );

  const pendingRun = scheduler.runOnce();
  await scheduler.runOnce();
  release();
  await pendingRun;

  assert.equal(calls, 1);
  assert.equal(logs.some((entry) => entry.level === 'warn' && String(entry.args[0]).includes('skipping overlap')), true);
});
