import type { BetterAuthError } from '@better-auth/core/error';
import type { ContractComparison } from '../contract/compare';
import { contractMismatchError } from '../contract/contract-check';
import { contractMessage } from '../contract/message';

const additionKinds: ReadonlySet<string> = new Set(['missing-model', 'missing-field']);

/** The error `auth generate` throws when it writes nothing: the contract message, then why the contract was not changed. */
export function notChanged(comparison: ContractComparison, reason?: string): BetterAuthError {
  const message = contractMessage(comparison) ?? '';
  return contractMismatchError(
    reason === undefined
      ? message
      : `${message}\n\n\`auth generate\` did not change your contract, because ${reason}`,
  );
}

/** Throws the contract message when the comparison found something other than a missing model or field, which `auth generate` does not fix. */
export function assertOnlyAdditions(comparison: ContractComparison): void {
  if (comparison.problems.some((problem) => !additionKinds.has(problem.kind))) {
    throw notChanged(comparison);
  }
}

export function listOf(items: readonly string[]): string {
  const last = items.at(-1);
  return items.length < 2 || last === undefined
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${last}`;
}
