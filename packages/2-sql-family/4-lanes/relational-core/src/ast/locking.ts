import { type StructuredError, structuredError } from '@internal/utils/structured-error';
import type { LockStrength, LockWaitPolicy } from './types';

/** What a row lock was combined with when it was refused, as `meta.conflict` of `ORM.LOCK_INCOMPATIBLE`. */
export type LockConflict =
  | 'distinct'
  | 'distinctOn'
  | 'groupBy'
  | 'having'
  | 'aggregate'
  | 'subquery'
  | 'include'
  | 'includeRefinement'
  | 'mutation';

/** The `ORM.LOCK_INCOMPATIBLE` error for a lock refused because of `conflict`. */
export function lockIncompatible(conflict: LockConflict, message: string): StructuredError {
  return structuredError('ORM.LOCK_INCOMPATIBLE', message, { meta: { conflict } });
}

/** A capability requirement: each group's flags that must be reported as `true`. */
export type CapabilityRequirement = {
  readonly [group: string]: { readonly [flag: string]: true };
};

/** The capability each lock strength needs. */
export const lockStrengthCapabilities = {
  forUpdate: { sql: { forUpdate: true } },
  forNoKeyUpdate: { postgres: { forNoKeyUpdate: true } },
  forShare: { sql: { forShare: true } },
  forKeyShare: { postgres: { forKeyShare: true } },
} as const satisfies Record<LockStrength, CapabilityRequirement>;

/** The capability each locking option needs; the wait-policy keys equal the `LockWaitPolicy` values. */
export const lockOptionCapabilities = {
  of: { sql: { lockOf: true } },
  nowait: { sql: { lockNowait: true } },
  skipLocked: { sql: { lockSkipLocked: true } },
} as const satisfies Record<'of' | LockWaitPolicy, CapabilityRequirement>;

export type LockStrengthCapabilities = typeof lockStrengthCapabilities;
export type LockOptionCapabilities = typeof lockOptionCapabilities;

/** The first flag in `requirement` that `capabilities` does not report as `true`, as `group.flag`. */
export function missingCapability(
  capabilities: { readonly [group: string]: { readonly [flag: string]: unknown } | undefined },
  requirement: CapabilityRequirement,
): string | undefined {
  for (const [group, flags] of Object.entries(requirement)) {
    for (const flag of Object.keys(flags)) {
      if (capabilities[group]?.[flag] !== true) return `${group}.${flag}`;
    }
  }
  return undefined;
}

/** The wait-policy options of a locking method; each key exists only when its capability is reported. */
export type LockWaitOptions<Capabilities> =
  | (Capabilities extends LockOptionCapabilities['nowait']
      ? { readonly nowait?: true; readonly skipLocked?: never }
      : never)
  | (Capabilities extends LockOptionCapabilities['skipLocked']
      ? { readonly skipLocked?: true; readonly nowait?: never }
      : never)
  | { readonly nowait?: never; readonly skipLocked?: never };

/** The wait-policy options as a locking method receives them at run time. */
export interface LockWaitRequest {
  readonly nowait?: true;
  readonly skipLocked?: true;
}

/** Turns `{ nowait, skipLocked }` into a wait policy, refusing both together with `ORM.ARGUMENT_INVALID`. */
export function lockWaitPolicyOf(
  methodName: string,
  options: LockWaitRequest | undefined,
): LockWaitPolicy | undefined {
  if (options?.nowait && options.skipLocked) {
    throw structuredError(
      'ORM.ARGUMENT_INVALID',
      `${methodName}() takes nowait or skipLocked, not both`,
      { meta: { method: methodName } },
    );
  }
  if (options?.nowait) return 'nowait';
  if (options?.skipLocked) return 'skipLocked';
  return undefined;
}
