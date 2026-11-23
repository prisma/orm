import { apiKey } from '@better-auth/api-key';
import type { BetterAuthOptions, BetterAuthPlugin } from '@better-auth/core';
import { oauthProvider } from '@better-auth/oauth-provider';
import { passkey } from '@better-auth/passkey';
import { scim } from '@better-auth/scim';
import { sso } from '@better-auth/sso';
import { blindCast } from '@prisma/orm-framework/utils/casts';
import {
  admin,
  anonymous,
  deviceAuthorization,
  jwt,
  lastLoginMethod,
  organization,
  phoneNumber,
  siwe,
  twoFactor,
  username,
} from 'better-auth/plugins';

/** Every first-party plugin that adds tables or fields, with the options that make each add all of its schema. */
export const everyFirstPartyPlugin: BetterAuthOptions = {
  rateLimit: { storage: 'database' },
  plugins: [
    organization({ teams: { enabled: true }, dynamicAccessControl: { enabled: true } }),
    twoFactor(),
    username(),
    admin(),
    anonymous(),
    phoneNumber(),
    siwe({
      domain: 'example.com',
      getNonce: async () => 'nonce',
      verifyMessage: async () => true,
    }),
    jwt(),
    deviceAuthorization(),
    lastLoginMethod({ storeInDatabase: true }),
    apiKey(),
    passkey(),
    sso(),
    oauthProvider({ loginPage: '/sign-in', consentPage: '/consent' }),
    blindCast<
      BetterAuthPlugin,
      'scim types its schema with optional tables, which exactOptionalPropertyTypes refuses as a BetterAuthPlugin schema'
    >(
      scim({
        connections: [],
        managedConnections: { credentialHashSecret: 'a-secret-of-at-least-thirty-two-characters' },
      }),
    ),
  ],
};
