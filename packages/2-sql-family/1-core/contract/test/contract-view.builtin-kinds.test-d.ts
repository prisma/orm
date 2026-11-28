import type { SingleNamespaceView } from '@internal/framework-components/ir';
import { expectTypeOf, test } from 'vitest';
import type { SqlBuiltinKind } from '../src/contract-view';

type Entries = {
  readonly table: { readonly users: { readonly name: 'users' } };
  readonly policy: { readonly ownRows: { readonly name: 'ownRows' } };
};

type View = SingleNamespaceView<Entries, SqlBuiltinKind>;

test('a pack-contributed kind stays reachable under entries', () => {
  expectTypeOf<View['entries']['policy']>().toEqualTypeOf<Entries['policy']>();
});

test('a misspelled kind under entries is a compile error', () => {
  const view = null as unknown as View;
  // @ts-expect-error 'polcy' is not a kind the namespace carries
  view.entries.polcy;
});
