import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import type { LooseOrm } from './run-on-orm';

export function withoutCapabilities<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  removed: readonly string[],
): ExecutionContext<TContract> {
  const capabilities = Object.fromEntries(
    Object.entries(context.contract.capabilities).map(([group, entries]) => [
      group,
      Object.fromEntries(Object.entries(entries).filter(([name]) => !removed.includes(name))),
    ]),
  );
  return { ...context, contract: { ...context.contract, capabilities } };
}

export interface Paths {
  readonly reference: LooseOrm;
  readonly varied: (removedCapabilities: readonly string[]) => LooseOrm;
  readonly clear: () => void | Promise<void>;
}
