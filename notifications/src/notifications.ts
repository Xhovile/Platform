import type { EntityId, ISODateString, Timestamped } from '../../shared/types/common';

export type NotificationChannel = 'email' | 'sms' | 'push' | 'in_app';
export type NotificationStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'read';

export interface NotificationPayload {
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationRecord extends Timestamped {
  id: EntityId;
  userId: EntityId;
  channel: NotificationChannel;
  status: NotificationStatus;
  payload: NotificationPayload;
  sentAt?: ISODateString | null;
  deliveredAt?: ISODateString | null;
  readAt?: ISODateString | null;
}

export interface QueueNotificationInput {
  userId: EntityId;
  channel: NotificationChannel;
  payload: NotificationPayload;
}
