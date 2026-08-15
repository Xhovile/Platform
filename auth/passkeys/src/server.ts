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

export type PasskeyServerConfig = PasskeyRpConfig & {
  challengeTtlMs?: number;
};

const DEFAULT_CHALLENGE_TTL_MS = 10 * 60 * 1000;

function baseConfig(config: PasskeyServerConfig) {
  return {
    rpName: config.rpName,
    rpID: config.rpID,
    origin: config.origin,
    challengeTtlMs: config.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS,
  };
}

export async function createRegistrationOptions(
  user: PasskeyUser,
  credentials: PasskeyCredential[],
  ceremonyRepository: PasskeyCeremonyRepository,
  config: PasskeyServerConfig,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const cfg = baseConfig(config);

  const options = await generateRegistrationOptions({
    rpName: cfg.rpName,
    rpID: cfg.rpID,
    userName: user.name,
    userDisplayName: user.displayName || user.name,
    attestationType: 'none',
    excludeCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports as never,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  await ceremonyRepository.save({
    userId: user.id,
    kind: 'registration',
    challenge: options.challenge,
    expiresAt: new Date(Date.now() + cfg.challengeTtlMs),
  });

  return options;
}

export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  ceremonyRepository: PasskeyCeremonyRepository,
  credentialRepository: PasskeyCredentialRepository,
  config: PasskeyServerConfig,
): Promise<{ verified: boolean; credential?: PasskeyCredential }> {
  const ceremony = await ceremonyRepository.consume(userId, 'registration');
  if (!ceremony || ceremony.expiresAt.getTime() < Date.now()) {
    return { verified: false };
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false };
  }

  const info = verification.registrationInfo;
  const credential: PasskeyCredential = {
    id: info.credential.id,
    publicKey: info.credential.publicKey,
    counter: info.credential.counter,
    transports: info.credential.transports,
    userId,
    createdAt: new Date(),
  };

  await credentialRepository.create(credential);
  return { verified: true, credential };
}

export async function createAuthenticationOptions(
  userId: string,
  credentials: PasskeyCredential[],
  ceremonyRepository: PasskeyCeremonyRepository,
  config: PasskeyServerConfig,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const cfg = baseConfig(config);

  const options = await generateAuthenticationOptions({
    rpID: cfg.rpID,
    allowCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports as never,
    })),
    userVerification: 'preferred',
  });

  await ceremonyRepository.save({
    userId,
    kind: 'authentication',
    challenge: options.challenge,
    expiresAt: new Date(Date.now() + cfg.challengeTtlMs),
  });

  return options;
}

export async function verifyAuthentication(
  userId: string,
  response: AuthenticationResponseJSON,
  ceremonyRepository: PasskeyCeremonyRepository,
  credentialRepository: PasskeyCredentialRepository,
  config: PasskeyServerConfig,
): Promise<{ verified: boolean; credentialId?: string }> {
  const ceremony = await ceremonyRepository.consume(userId, 'authentication');
  if (!ceremony || ceremony.expiresAt.getTime() < Date.now()) {
    return { verified: false };
  }

  const credential = await credentialRepository.findByCredentialId(response.id);
  if (!credential || credential.userId !== userId) {
    return { verified: false };
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    credential: {
      id: credential.id,
      publicKey: new Uint8Array(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports as never,
    },
    requireUserVerification: false,
  });

  if (!verification.verified) {
    return { verified: false };
  }

  await credentialRepository.updateCounter(
    credential.id,
    verification.authenticationInfo.newCounter,
  );

  return { verified: true, credentialId: credential.id };
}
