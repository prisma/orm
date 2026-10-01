import type { BindSiteParams } from '@internal/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import { createCollectionFor } from './collection-fixtures';

declare const p: BindSiteParams<{
  count: 'pg/int8number@1';
  column: 'pg/int4@1';
  text: 'pg/text@1';
  nullable: { codecId: 'pg/int8number@1'; nullable: true };
}>;

test('grouped preparation preserves contributed results and codec-aware HAVING operands', () => {
  const { collection } = createCollectionFor('Post');
  const grouped = collection.groupBy('userId');
  const selected = grouped
    .having((h) => h.count().gte(p.count))
    .having((h) => h.min('id').eq(p.column))
    .having((h) => h.sum('views').neq(p.nullable))
    .orderBy((post) => post.userId.asc())
    .limit(p.column)
    .offset(p.count);
  const prepared = selected.prepared.aggregate((agg) => ({
    total: agg.countBigInt(),
    min: agg.min('id'),
  }));
  expectTypeOf(prepared.consume).returns.toEqualTypeOf<
    Promise<Array<{ userId: number; total: bigint; min: number | null }>>
  >();
  // @ts-expect-error count output codec is not the input column codec
  grouped.having((h) => h.count().eq(p.column));
  // @ts-expect-error field metric uses its selected output codec
  grouped.having((h) => h.min('id').eq(p.count));
  // @ts-expect-error nullable ordered comparands remain unsupported
  grouped.having((h) => h.count().gt(p.nullable));
  // @ts-expect-error projection-only contributions remain unavailable in HAVING
  grouped.having((h) => h.countBigInt().eq(p.count));
  // @ts-expect-error grouped pagination still requires ordering
  grouped.limit(p.count);
  // @ts-expect-error grouped ordering only admits group keys
  grouped.orderBy((post) => post.id.asc());
  // @ts-expect-error grouped pagination rejects nullable operands
  selected.limit(p.nullable);
  // @ts-expect-error grouped pagination rejects text operands
  selected.offset(p.text);
  // @ts-expect-error selectors accept field names rather than placeholders
  selected.prepared.aggregate((agg) => ({ min: agg.min(p.column) }));
});
