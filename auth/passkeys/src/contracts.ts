import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

export type PasskeyCredential = {
  id: string;
  publicKey: Uint8Array | ArrayBuffer;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  userId: string;
  createdAt: Date;
  lastUsedAt?: Date;
  name?: string;
  deviceType?: 'singleDevice' | 'multiDevice';
  backedUp?: boolean;
};

export type PasskeyRpConfig = {
  rpName: string;
  rpID: string;
  origin: string | string[];
};

export type PasskeyUser = {
  id: string;
  name: string;
  displayName: string;
};

export interface PasskeyCredentialRepository {
  listByUser(userId: string): Promise<PasskeyCredential[]>;
  findByCredentialId(credentialId: string): Promise<PasskeyCredential | null>;
  create(credential: PasskeyCredential): Promise<void>;
  updateCounter(credentialId: string, counter: number): Promise<void>;
  touch(credentialId: string, at: Date): Promise<void>;
  revoke(credentialId: string): Promise<void>;
}

export type CeremonyKind = 'registration' | 'authentication';

export type CeremonyState = {
  id: string;
  kind: CeremonyKind;
  userId?: string;
  challenge: string;
  expiresAt: Date;
};

export interface PasskeyCeremonyRepository {
  save(state: CeremonyState): Promise<void>;
  consume(ceremonyId: string): Promise<CeremonyState | null>;
}
