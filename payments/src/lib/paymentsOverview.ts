import type { BuyerPaymentRecord } from './buyerState';
import type { OrderBundle } from './orderApi';
import { getOrderFlowType, type OrderFlowType } from './orderFlow';

export type PaymentsStatus = 'pending' | 'paid' | 'rejected' | 'error';

export type PaymentOverviewRecord = {
  key: string;
  reference: string;
  title: string;
  amount: number;
  currency: string;
  status: PaymentsStatus;
  detail: string;
  updatedAt: string | null;
  flowType: OrderFlowType;
};

export type PaymentsOverview = {
  balance: {
    available: number;
    pending: number;
    paid: number;
    rejected: number;
    held: number;
  };
  statusCounts: Record<PaymentsStatus, number>;
  disputeCount: number;
  records: PaymentOverviewRecord[];
};

const SUCCESS_PAYMENT_STATUSES = new Set(['paid', 'captured', 'verified', 'successful', 'completed']);
const PENDING_PAYMENT_STATUSES = new Set(['pending', 'initiated', 'processing', 'queued', 'awaiting_payment']);
const REJECTED_PAYMENT_STATUSES = new Set(['rejected', 'cancelled', 'refunded']);
const ERROR_PAYMENT_STATUSES = new Set(['failed', 'error']);
const RELEASED_ESCROW_STATES = new Set(['released', 'closed']);
const HELD_ESCROW_STATES = new Set(['held', 'disputed']);
const AVAILABLE_ORDER_STATUSES = new Set(['fulfilled', 'closed']);
const PAID_ORDER_STATUSES = new Set(['paid', 'in_escrow', 'fulfilled', 'closed']);
const REJECTED_ORDER_STATUSES = new Set(['cancelled', 'refunded']);
const PENDING_ORDER_STATUSES = new Set(['draft', 'pending_payment']);

type OrderItemLike = {
  title?: unknown;
  name?: unknown;
  quantity?: unknown;
  unitPrice?: {
    amount?: unknown;
    currency?: unknown;
  };
  kind?: unknown;
  listingId?: unknown;
  eventId?: unknown;
};

type TitleBucket = {
  title: string;
  quantity: number;
};

function normalizeToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasAnyString(values: unknown): boolean {
  return Array.isArray(values) && values.some((value) => typeof value === 'string' && value.trim());
}

function hasListingSignals(source: Record<string, unknown> | null | undefined): boolean {
  if (!source) return false;
  if (typeof source.listingId === 'string' && source.listingId.trim()) return true;
  if (hasAnyString(source.listingIds)) return true;
  if (Array.isArray(source.checkoutItems) && source.checkoutItems.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.listingId === 'string' && candidate.listingId.trim();
  })) return true;
  if (Array.isArray(source.items) && source.items.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Record<string, unknown>;
    return candidate.kind === 'listing' || (typeof candidate.listingId === 'string' && candidate.listingId.trim());
  })) return true;
  return false;
}

function hasEventSignals(source: Record<string, unknown> | null | undefined): boolean {
  if (!source) return false;
  if (typeof source.eventId === 'string' && source.eventId.trim()) return true;
  if (hasAnyString(source.eventIds)) return true;
  if (Array.isArray(source.eventDetails) && source.eventDetails.length > 0) return true;
  if (Array.isArray(source.checkoutItems) && source.checkoutItems.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.eventId === 'string' && candidate.eventId.trim();
  })) return true;
  if (Array.isArray(source.items) && source.items.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Record<string, unknown>;
    return candidate.kind === 'event_ticket' || (typeof candidate.eventId === 'string' && candidate.eventId.trim());
  })) return true;
  return false;
}

function classifyStoredPaymentFlowType(record: BuyerPaymentRecord): OrderFlowType {
  const listingSignals = hasListingSignals(record as unknown as Record<string, unknown>);
  const eventSignals = hasEventSignals(record as unknown as Record<string, unknown>);

  if (listingSignals && eventSignals) return 'mixed_checkout';
  if (eventSignals) return 'event_only';
  if (listingSignals) return 'listing_only';
  return 'unknown';
}

function classifyOrderStatus(bundle: OrderBundle): PaymentsStatus {
  const orderStatus = normalizeToken(bundle.order?.status);
  const paymentStatus = normalizeToken(bundle.payment?.status);

  if (ERROR_PAYMENT_STATUSES.has(paymentStatus)) return 'error';
  if (REJECTED_PAYMENT_STATUSES.has(paymentStatus) || REJECTED_ORDER_STATUSES.has(orderStatus)) return 'rejected';
  if (PENDING_PAYMENT_STATUSES.has(paymentStatus) || PENDING_ORDER_STATUSES.has(orderStatus) || !paymentStatus) return 'pending';
  if (SUCCESS_PAYMENT_STATUSES.has(paymentStatus) || PAID_ORDER_STATUSES.has(orderStatus)) return 'paid';
  return 'pending';
}

function classifyStoredPaymentStatus(record: BuyerPaymentRecord): PaymentsStatus {
  if (record.status === 'captured') return 'paid';
  if (record.status === 'refunded' || record.status === 'cancelled') return 'rejected';
  if (record.status === 'failed') return 'error';
  return 'pending';
}

function getOrderReference(bundle: OrderBundle): string {
  if (typeof bundle.order?.paymentReference === 'string' && bundle.order.paymentReference.trim()) {
    return bundle.order.paymentReference;
  }
  return String(bundle.order?.id ?? 'Unknown reference');
}

function getItemQuantity(item: OrderItemLike): number {
  const raw = Number(item.quantity ?? 1);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function getItemTitle(item: OrderItemLike): string {
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null;
  if (title) return title;

  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null;
  if (name) return name;

  return 'Item';
}

function isListingItem(item: OrderItemLike): boolean {
  return item.kind === 'listing' || !!item.listingId || (!item.kind && !item.eventId);
}

function getItemSubtotal(item: OrderItemLike): number | null {
  const amount = item.unitPrice?.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const quantity = getItemQuantity(item);
  return amount * quantity;
}

function formatTitleBucket(bucket: TitleBucket): string {
  return bucket.quantity > 1 ? `${bucket.title} ×${bucket.quantity}` : bucket.title;
}

function buildOrderTitle(items: OrderItemLike[] | undefined): string {
  if (!Array.isArray(items) || items.length === 0) {
    return 'Untitled order';
  }

  const buckets: TitleBucket[] = [];
  const bucketByKey = new Map<string, TitleBucket>();

  for (const item of items) {
    const title = getItemTitle(item);
    const quantity = getItemQuantity(item);
    const key = title.trim().toLowerCase();
    const existing = bucketByKey.get(key);

    if (existing) {
      existing.quantity += quantity;
    } else {
      const bucket = { title, quantity };
      bucketByKey.set(key, bucket);
      buckets.push(bucket);
    }
  }

  if (buckets.length === 1) {
    return formatTitleBucket(buckets[0]);
  }

  const first = buckets[0];
  const second = buckets[1];
  const remainingCount = buckets.slice(2).reduce((total, bucket) => total + bucket.quantity, 0);

  if (!second) {
    return formatTitleBucket(first);
  }

  const head = `${formatTitleBucket(first)}, ${formatTitleBucket(second)}`;
  if (remainingCount <= 0) {
    return head;
  }

  return `${head} +${remainingCount} more`;
}

function getDisplayedOrderAmount(bundle: OrderBundle, flowType: OrderFlowType): number {
  const totalAmount = Number(bundle.order?.total?.amount ?? 0);
  if (flowType !== 'mixed_checkout') {
    return totalAmount;
  }

  const listingSubtotal = Array.isArray(bundle.order?.items)
    ? bundle.order.items.reduce((sum, item) => {
        if (!isListingItem(item)) return sum;
        return sum + (getItemSubtotal(item) ?? 0);
      }, 0)
    : 0;

  return listingSubtotal > 0 ? listingSubtotal : totalAmount;
}

function buildOrderDetail(bundle: OrderBundle, flowType: OrderFlowType): string {
  const escrowState = normalizeToken(bundle.escrow?.state);
  const orderStatus = String(bundle.order?.status ?? 'pending');

  if (flowType === 'mixed_checkout') {
    return 'Listing total shown here. Ticket details live in Tickets.';
  }

  if (flowType === 'event_only') {
    return 'Ticket details live in Tickets.';
  }

  if (HELD_ESCROW_STATES.has(escrowState)) {
    return escrowState === 'disputed' ? 'Funds are currently disputed.' : 'Funds are currently being held in escrow.';
  }

  if (RELEASED_ESCROW_STATES.has(escrowState) || AVAILABLE_ORDER_STATUSES.has(normalizeToken(bundle.order?.status))) {
    return 'Payment is complete and available in the finished order flow.';
  }

  return `Order status: ${orderStatus.replace(/_/g, ' ')}`;
}

function buildStoredPaymentDetail(record: BuyerPaymentRecord): string {
  if (record.status === 'captured') return 'Payment captured successfully.';
  if (record.status === 'failed') return 'Payment returned an error.';
  if (record.status === 'refunded') return 'Payment was refunded.';
  if (record.status === 'cancelled') return 'Payment was cancelled.';
  return 'Payment is still pending confirmation.';
}

function getStringField(source: Record<string, unknown> | null | undefined, field: string): string | null {
  const value = source?.[field];
  return typeof value === 'string' && value.trim() ? value : null;
}

function getOrderActivityTimestamp(bundle: OrderBundle): string | null {
  return (
    getStringField(bundle.escrow, 'updatedAt') ??
    getStringField(bundle.escrow, 'updated_at') ??
    getStringField(bundle.payment, 'updatedAt') ??
    getStringField(bundle.payment, 'updated_at') ??
    getStringField(bundle.payment, 'paidAt') ??
    getStringField(bundle.payment, 'paid_at') ??
    getStringField(bundle.order, 'updatedAt') ??
    getStringField(bundle.order, 'updated_at') ??
    getStringField(bundle.order, 'paidAt') ??
    getStringField(bundle.order, 'paid_at') ??
    getStringField(bundle.order, 'placedAt') ??
    getStringField(bundle.order, 'placed_at') ??
    getStringField(bundle.order, 'createdAt') ??
    getStringField(bundle.order, 'created_at')
  );
}

function buildOrderReferenceNotes(bundle: OrderBundle, flowType: OrderFlowType): string {
  if (flowType === 'mixed_checkout') {
    const hasListing = Array.isArray(bundle.order?.items) && bundle.order.items.some(isListingItem);
    const hasEvent = Array.isArray(bundle.order?.items) && bundle.order.items.some((item) => !isListingItem(item) && (item.kind === 'event_ticket' || !!item.eventId));
    if (hasListing && hasEvent) return 'This order combines listing items and a ticket. Open Tickets for ticket details.';
  }

  if (flowType === 'event_only') {
    return 'Event ticket details are managed in Tickets.';
  }

  return buildOrderDetail(bundle, flowType);
}

export function summarizePayments(
  orders: OrderBundle[],
  buyerPayments: BuyerPaymentRecord[],
): PaymentsOverview {
  const summary: PaymentsOverview = {
    balance: {
      available: 0,
      pending: 0,
      paid: 0,
      rejected: 0,
      held: 0,
    },
    statusCounts: {
      pending: 0,
      paid: 0,
      rejected: 0,
      error: 0,
    },
    disputeCount: 0,
    records: [],
  };

  const seenReferences = new Set<string>();

  orders.forEach((bundle) => {
    const reference = getOrderReference(bundle);
    const flowType = getOrderFlowType(bundle);
    const amount = getDisplayedOrderAmount(bundle, flowType);
    const currency = String(bundle.order?.total?.currency ?? 'MWK');
    const status = classifyOrderStatus(bundle);
    const escrowState = normalizeToken(bundle.escrow?.state);
    const hasHeldBalance = HELD_ESCROW_STATES.has(escrowState) || normalizeToken(bundle.order?.status) === 'disputed' || Boolean(bundle.dispute);

    summary.statusCounts[status] += 1;
    if (status === 'pending') summary.balance.pending += amount;
    if (status === 'paid') summary.balance.paid += amount;
    if (status === 'rejected') summary.balance.rejected += amount;
    if (hasHeldBalance) {
      summary.balance.held += amount;
      summary.disputeCount += 1;
    }
    if (status === 'paid' && (RELEASED_ESCROW_STATES.has(escrowState) || AVAILABLE_ORDER_STATUSES.has(normalizeToken(bundle.order?.status)))) {
      summary.balance.available += amount;
    }

    summary.records.push({
      key: `order-${reference}`,
      reference,
      title: buildOrderTitle(bundle.order?.items as OrderItemLike[] | undefined),
      amount,
      currency,
      status,
      detail: buildOrderReferenceNotes(bundle, flowType),
      updatedAt: getOrderActivityTimestamp(bundle),
      flowType,
    });

    seenReferences.add(reference);
    if (bundle.order?.id) seenReferences.add(String(bundle.order.id));
  });

  buyerPayments.forEach((record) => {
    if (seenReferences.has(record.reference) || (record.orderId && seenReferences.has(String(record.orderId)))) {
      return;
    }

    const status = classifyStoredPaymentStatus(record);
    summary.statusCounts[status] += 1;

    if (status === 'pending') summary.balance.pending += Number(record.totalPrice ?? 0);
    if (status === 'paid') summary.balance.paid += Number(record.totalPrice ?? 0);
    if (status === 'rejected') summary.balance.rejected += Number(record.totalPrice ?? 0);
    if (status === 'paid' && record.deliveryConfirmed) {
      summary.balance.available += Number(record.totalPrice ?? 0);
    }

    summary.records.push({
      key: `payment-${record.reference}`,
      reference: record.reference,
      title: record.listingTitle,
      amount: Number(record.totalPrice ?? 0),
      currency: 'MWK',
      status,
      detail: buildStoredPaymentDetail(record),
      updatedAt: record.updatedAt ?? record.createdAt ?? null,
      flowType: classifyStoredPaymentFlowType(record),
    });
  });

  summary.records.sort((left, right) => {
    const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
    const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
    return rightTime - leftTime;
  });

  return summary;
}