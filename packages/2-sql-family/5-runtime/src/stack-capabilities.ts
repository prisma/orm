import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlExecutionStackWithDriver } from './sql-context';

type CapabilitySet = Readonly<Record<string, unknown>> | undefined;

function flagIn(set: CapabilitySet, namespace: string, flag: string): unknown {
  const flags = set?.[namespace];
  return typeof flags === 'object' && flags !== null ? Reflect.get(flags, flag) : undefined;
}

/**
 * The capabilities `contract` requires that the stack does not provide, as `namespace.flag`. The database's capabilities, which the target declares, are left out: signing checks the database for them. Every other capability must be provided by the adapter, the driver or an extension.
 */
export function capabilitiesTheStackDoesNotProvide(
  contract: Contract<SqlStorage>,
  stack: SqlExecutionStackWithDriver,
): readonly string[] {
  const providers: readonly CapabilitySet[] = [
    stack.adapter.capabilities,
    stack.driver.capabilities,
    ...stack.extensions.map((extension) => extension.capabilities),
  ];
  const missing: string[] = [];
  for (const [namespace, flags] of Object.entries(contract.capabilities)) {
    for (const [flag, required] of Object.entries(flags)) {
      if (!required || flagIn(stack.target.databaseCapabilities, namespace, flag) !== undefined)
        continue;
      if (!providers.some((set) => flagIn(set, namespace, flag) === true)) {
        missing.push(`${namespace}.${flag}`);
      }
    }
  }
  return missing;
}
