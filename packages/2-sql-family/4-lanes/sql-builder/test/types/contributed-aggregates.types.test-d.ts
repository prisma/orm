/**
 * Type-test: the aggregate method surface derives from the contract's emitted
 * aggregate map. A contributed operation name — one no lane source spells out —
 * surfaces as a typed method with exactly the arities its rows admit, an
 * operation the map does not declare is no method at all, and a context whose
 * map is unknown carries no methods rather than an index signature.
 */

import { expectTypeOf, test } from 'vitest';
import type { AggregateOnlyFunctions, Expression, FieldProxy } from '../../src/expression';
import type { Scope } from '../../src/scope';

type CT = {
  'syn/int@1': { input: number; output: number };
  'syn/text@1': { input: string; output: string };
};

type QC = {
  codecTypes: CT;
  capabilities: Record<string, Record<string, boolean>>;
  queryOperationTypes: Record<string, never>;
  resolvedColumnOutputTypes: Record<string, never>;
  aggregateTypes: {
    median: {
      byCodec: {
        'syn/int@1': { output: 'syn/float@1'; nullable: true };
      };
    };
    tally: {
      byCodec: Record<never, never>;
      withoutInput: { output: 'syn/int8@1'; nullable: false };
    };
  };
};

type OrderColumns = {
  id: { codecId: 'syn/int@1'; nullable: false };
  name: { codecId: 'syn/text@1'; nullable: true };
};
type OrderScope = Scope & {
  topLevel: OrderColumns;
  namespaces: { Order: OrderColumns };
};

declare const f: FieldProxy<OrderScope>;
declare const fns: AggregateOnlyFunctions<QC>;

test('a contributed operation surfaces as a field-taking method typed by its byCodec row', () => {
  expectTypeOf(fns.median(f.id)).toEqualTypeOf<
    Expression<{ codecId: 'syn/float@1'; nullable: true }>
  >();
});

test('a contributed no-input operation surfaces as a zero-argument method', () => {
  expectTypeOf(fns.tally()).toEqualTypeOf<Expression<{ codecId: 'syn/int8@1'; nullable: false }>>();
});

test('a field-taking call on an input codec no row claims is rejected at the call site', () => {
  // @ts-expect-error — no byCodec row for syn/text@1 and no anyInput fallback
  fns.median(f.name);
});

test('a zero-argument call without a withoutInput row is rejected at the call site', () => {
  // @ts-expect-error — median declares no withoutInput row
  fns.median();
});

test('a field-taking call on a no-input-only operation is rejected at the call site', () => {
  // @ts-expect-error — tally declares no byCodec or anyInput rows
  fns.tally(f.id);
});

test('an operation the map does not declare is not a method', () => {
  // @ts-expect-error — the map declares no count rows at all
  fns.count();
});

type MapLessQC = Omit<QC, 'aggregateTypes'> & { aggregateTypes: Record<string, never> };

declare const mapLessFns: AggregateOnlyFunctions<MapLessQC>;

test('a context whose aggregate map is unknown carries no methods', () => {
  // @ts-expect-error — an unknown map yields no index signature, so the name is a property error
  mapLessFns['whoops'];
});
