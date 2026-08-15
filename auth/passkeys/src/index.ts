export * from './contracts.js';
export {
  createAuthenticationOptions,
  createDiscoverableAuthenticationOptions,
  createRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type PasskeyOptionsResult,
  type PasskeyServerConfig,
} from './server.js';
export {
  authenticateWithPasskey,
  isPasskeySupported,
  registerPasskey,
} from './browser.js';
