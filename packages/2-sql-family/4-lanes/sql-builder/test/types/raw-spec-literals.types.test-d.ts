/**
 * Type-test: a row-spec entry keeps its literal codec id through inference.
 *
 * The codec map here is declared locally rather than taken from the emitted
 * fixture, so the assertions hold whatever that fixture resolves to — a spec
 * entry typed `string` widens `'syn/int8@1'` to `string`, and a widened id
 * resolves to `unknown`, which is exactly what these cases would catch.
 */

import type { ResultType } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import type { ContractRawBuilder } from '../../src/types/raw-query';

type CT = {
  'syn/int8@1': { input: bigint; output: bigint };
  'syn/text@1': { input: string; output: string };
  'syn/int4@1': { input: number; output: number };
};

declare const raw: ContractRawBuilder<CT>;

test('a bare codec id keeps its literal through the row spec', () => {
  const plan = raw.returnsRow({ total: 'syn/int8@1', label: 'syn/text@1' }).build();
  type Row = ResultType<typeof plan>;

  expectTypeOf<Row['total']>().toEqualTypeOf<bigint>();
  expectTypeOf<Row['label']>().toEqualTypeOf<string>();
});

test('the object entry form keeps its literal and its nullability', () => {
  const plan = raw
    .returnsRow({
      total: { codecId: 'syn/int8@1' },
      maybe: { codecId: 'syn/int4@1', nullable: true },
    })
    .build();
  type Row = ResultType<typeof plan>;

  expectTypeOf<Row['total']>().toEqualTypeOf<bigint>();
  expectTypeOf<Row['maybe']>().toEqualTypeOf<number | null>();
});

test('an id the contract does not carry is rejected at the call site', () => {
  // @ts-expect-error — the entry names a codec the contract's map has no row for
  raw.returnsRow({ total: 'syn/nonexistent@1' });
});

// ── The fragment terminator on the contract-bound tag ────────────────────────

test('a fragment codec id keeps its literal through .returns()', () => {
  const expr = raw.returns('syn/int8@1');

  expectTypeOf(expr.returnType.codecId).toEqualTypeOf<'syn/int8@1'>();
  expectTypeOf(expr.returnType.nullable).toEqualTypeOf<false>();
});

test('the object form of .returns() keeps its literal and its nullability', () => {
  const expr = raw.returns({ codecId: 'syn/text@1', nullable: true });

  expectTypeOf(expr.returnType.codecId).toEqualTypeOf<'syn/text@1'>();
  expectTypeOf(expr.returnType.nullable).toEqualTypeOf<true>();
});

test('a fragment naming an id the contract does not carry is rejected', () => {
  // @ts-expect-error — the fragment names a codec the contract's map has no row for
  raw.returns('syn/nonexistent@1');
});

test('the object form rejects an unknown id too', () => {
  // @ts-expect-error — same rejection through the descriptor form
  raw.returns({ codecId: 'syn/nonexistent@1' });
});
