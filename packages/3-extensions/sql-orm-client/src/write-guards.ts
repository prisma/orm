import { ormError } from './orm-errors';
import type { CollectionState } from './types';

const CHAIN_PARTS = {
  orderBy: { noun: 'an order', call: 'orderBy()' },
  limit: { noun: 'a limit', call: 'limit()' },
  offset: { noun: 'an offset', call: 'offset()' },
  cursor: { noun: 'a cursor', call: 'cursor()' },
  distinct: { noun: 'a distinct selection', call: 'distinct()' },
  distinctOn: { noun: 'a distinctOn selection', call: 'distinctOn()' },
} as const;

type ChainPartName = keyof typeof CHAIN_PARTS;

interface PresentParts {
  readonly nouns: readonly string[];
  readonly calls: readonly string[];
}

function presentParts(state: CollectionState, names: readonly ChainPartName[]): PresentParts {
  const present = names.filter((name) => {
    const value = state[name];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });
  return {
    nouns: present.map((name) => CHAIN_PARTS[name].noun),
    calls: present.map((name) => CHAIN_PARTS[name].call),
  };
}

function listed(items: readonly string[], conjunction: 'and' | 'or'): string {
  const last = items.at(-1) ?? '';
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} ${conjunction} ${last}` : last;
}

const HIDDEN_BY_A_SCOPE = 'A scope passed to with can add one without showing it at the call site.';

/** Throws `ORM.ARGUMENT_INVALID` when the collection has a limit, an offset, a cursor or a distinct selection, which `method`, a write of every matching row, would ignore. */
export function assertBulkWriteIgnoresNothing(
  state: CollectionState,
  modelName: string,
  method: string,
): void {
  const { nouns, calls } = presentParts(state, [
    'limit',
    'offset',
    'cursor',
    'distinct',
    'distinctOn',
  ]);
  if (nouns.length === 0) {
    return;
  }
  const { limit, offset, cursor, distinct, distinctOn } = state;
  throw ormError(
    'ORM.ARGUMENT_INVALID',
    `Cannot ${method} ${modelName}: the collection has ${listed(nouns, 'and')}`,
    {
      why: `${method} changes every row that matches the filter. The statement it runs cannot apply ${listed(nouns, 'or')}, so it would change more rows than the chain asks for. ${HIDDEN_BY_A_SCOPE}`,
      fix: `Remove ${listed(calls, 'and')} before ${method}, or read the rows first and change them by their ids.`,
      meta: { model: modelName, method, limit, offset, cursor, distinct, distinctOn },
    },
  );
}

/** Throws `ORM.ARGUMENT_INVALID` when the collection has an order, a limit, an offset, a cursor or a distinct selection, which an update with a relation callback would ignore. */
export function assertRelationUpdateIgnoresNothing(
  state: CollectionState,
  modelName: string,
): void {
  const { nouns, calls } = presentParts(state, [
    'orderBy',
    'limit',
    'offset',
    'cursor',
    'distinct',
    'distinctOn',
  ]);
  if (nouns.length === 0) {
    return;
  }
  const { orderBy, limit, offset, cursor, distinct, distinctOn } = state;
  throw ormError(
    'ORM.ARGUMENT_INVALID',
    `Cannot update ${modelName} with a relation mutation: the collection has ${listed(nouns, 'and')}`,
    {
      why: `An update that changes a relation finds its row by the filter alone. It would ignore ${listed(nouns, 'and')}, and could change another row than first() returns. ${HIDDEN_BY_A_SCOPE}`,
      fix: `Remove ${listed(calls, 'and')} before update, or filter to the one row, such as by its id.`,
      meta: {
        model: modelName,
        method: 'update',
        ordered: orderBy !== undefined && orderBy.length > 0,
        limit,
        offset,
        cursor,
        distinct,
        distinctOn,
      },
    },
  );
}
