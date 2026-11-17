import { type LockConflict, lockIncompatible } from '@internal/sql-relational-core/ast';
import type { CollectionState, IncludeExpr } from './types';

/** A call whose result no longer carries the collection's lock, so it refuses a locked collection. */
export type LockDroppingCall = Extract<LockConflict, 'aggregate' | 'groupBy' | 'mutation'>;

function includeCarriesLock(include: IncludeExpr): boolean {
  const states = [
    include.nested,
    ...(include.scalar === undefined ? [] : [include.scalar.state]),
    ...Object.values(include.combine ?? {}).map((branch) =>
      branch.kind === 'rows' ? branch.state : branch.selector.state,
    ),
  ];
  return states.some(stateCarriesLock);
}

function stateCarriesLock(state: CollectionState): boolean {
  return state.locking !== undefined || state.includes.some(includeCarriesLock);
}

function conflictOf(
  state: CollectionState,
  call: LockDroppingCall | undefined,
): LockConflict | undefined {
  if (state.includes.some(includeCarriesLock)) return 'includeRefinement';
  if (state.locking === undefined) return undefined;
  if (call !== undefined) return call;
  if (state.includes.length > 0) return 'include';
  if (state.distinct !== undefined && state.distinct.length > 0) return 'distinct';
  if (state.distinctOn !== undefined && state.distinctOn.length > 0) return 'distinctOn';
  return undefined;
}

/** Refuses a row lock the ORM cannot render: inside an include, with include, distinct or distinctOn in the state, or before a call that drops it. */
export function assertLockCompatible(state: CollectionState, call?: LockDroppingCall): void {
  const conflict = conflictOf(state, call);
  if (conflict !== undefined) {
    throw lockIncompatible(conflict, `A locking clause cannot be combined with ${conflict}`);
  }
}
