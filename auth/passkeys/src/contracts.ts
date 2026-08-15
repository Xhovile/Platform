import type { AuthenticatorTransport } from '@simplewebauthn/server';

export type PasskeyCredential = {
  id: string;
  publicKey: Uint8Array | ArrayBuffer;
  counter: number;
  transports?: AuthenticatorTransport[];
  userId: string;
  createdAt: Date;
  lastUsedAt?: Date;
  name?: string;
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
  revoke(credentialId: string): Promise<void>;
}

export type CeremonyKind = 'registration' | 'authentication';

export type CeremonyState = {
  userId: string;
  kind: CeremonyKind;
  challenge: string;
  expiresAt: Date;
};

export interface PasskeyCeremonyRepository {
  save(state: CeremonyState): Promise<void>;
  consume(userId: string, kind: CeremonyKind): Promise<CeremonyState | null>;
}
