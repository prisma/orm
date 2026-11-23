import type { DatabasePolicies } from '@internal/framework-components/control';

/** A setting of the data protection policy. */
export type DataProtectionSetting = keyof DatabasePolicies['dataProtection'];

type LevelOf = { readonly [S in DataProtectionSetting]: DatabasePolicies['dataProtection'][S] };

/** Each data protection setting's `forbidden` level. */
export const FORBIDDEN_LEVEL = {
  dataLoss: 'data-loss-forbidden',
  accessWidening: 'access-widening-forbidden',
} as const satisfies LevelOf;

/** Each data protection setting's `permitted` level. */
export const PERMITTED_LEVEL = {
  dataLoss: 'data-loss-permitted',
  accessWidening: 'access-widening-permitted',
} as const satisfies LevelOf;
