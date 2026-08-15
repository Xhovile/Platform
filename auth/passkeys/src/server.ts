import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type {
  PasskeyCeremonyRepository,
  PasskeyCredential,
  PasskeyCredentialRepository,
  PasskeyRpConfig,
  PasskeyUser,
} from './contracts.js';

export type PasskeyServerConfig = PasskeyRpConfig & { challengeTtlMs?: number };
export type PasskeyOptionsResult<T> = { ceremonyId: string; options: T };
const DEFAULT_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const ttl = (config: PasskeyServerConfig) => config.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS;
const createCeremonyId = () => crypto.randomUUID();

export async function createRegistrationOptions(user: PasskeyUser, credentials: PasskeyCredential[], ceremonyRepository: PasskeyCeremonyRepository, config: PasskeyServerConfig): Promise<PasskeyOptionsResult<PublicKeyCredentialCreationOptionsJSON>> {
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: user.name,
    userDisplayName: user.displayName || user.name,
    ...(user.webAuthnUserId ? { userID: user.webAuthnUserId } : {}),
    attestationType: 'none',
    excludeCredentials: credentials.map(({ id, transports }) => ({ id, transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const ceremonyId = createCeremonyId();
  await ceremonyRepository.save({ id: ceremonyId, userId: user.id, kind: 'registration', challenge: options.challenge, expiresAt: new Date(Date.now() + ttl(config)) });
  return { ceremonyId, options };
}

export async function verifyRegistration(response: RegistrationResponseJSON, ceremonyId: string, ceremonyRepository: PasskeyCeremonyRepository, credentialRepository: PasskeyCredentialRepository, config: PasskeyServerConfig): Promise<{ verified: boolean; credential?: PasskeyCredential }> {
  const ceremony = await ceremonyRepository.consume(ceremonyId);
  if (!ceremony || ceremony.kind !== 'registration' || !ceremony.userId || ceremony.expiresAt.getTime() < Date.now()) return { verified: false };
  const verification = await verifyRegistrationResponse({ response, expectedChallenge: ceremony.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true });
  if (!verification.verified || !verification.registrationInfo) return { verified: false };
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const savedCredential: PasskeyCredential = { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports, userId: ceremony.userId, createdAt: new Date(), deviceType: credentialDeviceType, backedUp: credentialBackedUp };
  await credentialRepository.create(savedCredential);
  return { verified: true, credential: savedCredential };
}

export async function createAuthenticationOptions(userId: string, credentials: PasskeyCredential[], ceremonyRepository: PasskeyCeremonyRepository, config: PasskeyServerConfig): Promise<PasskeyOptionsResult<PublicKeyCredentialRequestOptionsJSON>> {
  const options = await generateAuthenticationOptions({ rpID: config.rpID, allowCredentials: credentials.map(({ id, transports }) => ({ id, transports })), userVerification: 'required' });
  const ceremonyId = createCeremonyId();
  await ceremonyRepository.save({ id: ceremonyId, userId, kind: 'authentication', challenge: options.challenge, expiresAt: new Date(Date.now() + ttl(config)) });
  return { ceremonyId, options };
}

export async function createDiscoverableAuthenticationOptions(ceremonyRepository: PasskeyCeremonyRepository, config: PasskeyServerConfig): Promise<PasskeyOptionsResult<PublicKeyCredentialRequestOptionsJSON>> {
  const options = await generateAuthenticationOptions({ rpID: config.rpID, userVerification: 'required' });
  const ceremonyId = createCeremonyId();
  await ceremonyRepository.save({ id: ceremonyId, kind: 'authentication', challenge: options.challenge, expiresAt: new Date(Date.now() + ttl(config)) });
  return { ceremonyId, options };
}

export async function verifyAuthentication(response: AuthenticationResponseJSON, ceremonyId: string, ceremonyRepository: PasskeyCeremonyRepository, credentialRepository: PasskeyCredentialRepository, config: PasskeyServerConfig): Promise<{ verified: boolean; credentialId?: string; userId?: string }> {
  const ceremony = await ceremonyRepository.consume(ceremonyId);
  if (!ceremony || ceremony.kind !== 'authentication' || ceremony.expiresAt.getTime() < Date.now()) return { verified: false };
  const credential = await credentialRepository.findByCredentialId(response.id);
  if (!credential || (ceremony.userId && credential.userId !== ceremony.userId)) return { verified: false };
  const verification = await verifyAuthenticationResponse({ response, expectedChallenge: ceremony.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, credential: { id: credential.id, publicKey: new Uint8Array(credential.publicKey), counter: credential.counter, transports: credential.transports }, requireUserVerification: true });
  if (!verification.verified) return { verified: false };
  await credentialRepository.updateCounter(credential.id, verification.authenticationInfo.newCounter);
  await credentialRepository.touch(credential.id, new Date());
  return { verified: true, credentialId: credential.id, userId: credential.userId };
}
