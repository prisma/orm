import { expectTypeOf } from 'vitest';
import { acc } from '../src/accumulator-helpers';
import type {
  DocField,
  NumericField,
  StringField,
  TypedAccumulatorExpr,
  TypedAggExpr,
} from '../src/types';

const d = {} as TypedAggExpr<DocField>;
const n = {} as TypedAggExpr<NumericField>;
const s = {} as TypedAggExpr<StringField>;

describe('accumulator helper types', () => {
  it('sum preserves input field type', () => {
    expectTypeOf(acc.sum(n)).toEqualTypeOf<TypedAccumulatorExpr<NumericField>>();
  });

  it('sum preserves non-double numeric codec', () => {
    type IntField = { readonly codecId: 'mongo/int@1'; readonly nullable: false };
    const intExpr = {} as TypedAggExpr<IntField>;
    expectTypeOf(acc.sum(intExpr)).toEqualTypeOf<TypedAccumulatorExpr<IntField>>();
  });

  it('rejects wrong type for firstN n key', () => {
    // @ts-expect-error — n requires NumericField, not StringField
    acc.firstN({ input: d, n: s });
  });

  it('rejects wrong type for topN n key', () => {
    // @ts-expect-error — n requires NumericField, not StringField
    acc.topN({ output: d, sortBy: { score: -1 }, n: s });
  });
});
