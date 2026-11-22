import type { BetterAuthOptions } from '@better-auth/core';
import type { BetterAuthDBSchema } from '@better-auth/core/db';
import * as internal from '@better-auth/core/db/internal';
import { BetterAuthError } from '@better-auth/core/error';
import { compareContract } from './contract/compare';
import { contractMessage } from './contract/message';
import type { SqlContract } from './contract/model-lookup';

export interface ContractCheckInput {
  readonly contract: SqlContract;
  readonly tables: BetterAuthDBSchema;
  readonly betterAuthOptions: BetterAuthOptions;
  readonly namespace: string | undefined;
  readonly usePlural: boolean;
}

/** The error the contract check rejects with and `createSchema` throws. Its `code` is what Better Auth's CLI looks for. */
export function contractMismatchError(
  message: string,
): BetterAuthError & { code: 'SCHEMA_MISMATCH' } {
  return Object.assign(new BetterAuthError(message), { code: 'SCHEMA_MISMATCH' as const });
}

/** The mismatch error for a contract, or `undefined` when it holds everything Better Auth needs. */
export function contractMismatch(input: ContractCheckInput): BetterAuthError | undefined {
  const message = contractMessage(compareContract(input));
  return message === undefined ? undefined : contractMismatchError(message);
}

type Verdict = { readonly clean: true } | { readonly clean: false; readonly error: unknown };

/**
 * A check that compares the contract on its first call and keeps the result: `undefined` when the contract is complete, and a promise rejected with the same error on every call when it is not.
 */
export function createContractCheck(
  input: () => ContractCheckInput,
): () => Promise<void> | undefined {
  let verdict: Verdict | undefined;
  return () => {
    if (verdict === undefined) {
      try {
        const error = contractMismatch(input());
        verdict = error === undefined ? { clean: true } : { clean: false, error };
      } catch (error) {
        verdict = { clean: false, error };
      }
    }
    return verdict.clean ? undefined : Promise.reject(verdict.error);
  };
}

/**
 * Registers the check with Better Auth, which runs it before requests, server-side API calls and transactions, and for `auth check`. Better Auth labels the entrypoint internal, so a version without `registerSchemaCheck` runs the adapter without a check.
 */
export function registerContractCheck(
  adapter: object,
  check: () => Promise<void> | undefined,
  betterAuthOptions: BetterAuthOptions,
): void {
  if (typeof internal.registerSchemaCheck !== 'function') return;
  internal.registerSchemaCheck(adapter, check, {
    runtimeEnabled: betterAuthOptions.advanced?.database?.validateSchema !== false,
  });
}
