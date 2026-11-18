import { expectTypeOf } from 'vitest';
import { fn } from '../src/expression-helpers';
import type {
  BooleanField,
  DateField,
  DocField,
  NumericField,
  StringField,
  TypedAggExpr,
} from '../src/types';

const d = {} as TypedAggExpr<DocField>;
const s = {} as TypedAggExpr<StringField>;
const n = {} as TypedAggExpr<NumericField>;
const dt = {} as TypedAggExpr<DateField>;
const b = {} as TypedAggExpr<BooleanField>;

describe('date helpers', () => {
  it('dateToString accepts optional keys', () => {
    expectTypeOf(fn.dateToString({ date: dt })).toEqualTypeOf<TypedAggExpr<StringField>>();
  });

  it('rejects wrong type for dateToString date key', () => {
    // @ts-expect-error — date requires DateField, not StringField
    fn.dateToString({ date: s });
  });
  it('rejects wrong type for dateAdd amount key', () => {
    // @ts-expect-error — amount requires NumericField, not StringField
    fn.dateAdd({ startDate: dt, unit: s, amount: s });
  });
});

describe('string helpers', () => {
  it('rejects wrong type for trim input key', () => {
    // @ts-expect-error — input requires StringField, not NumericField
    fn.trim({ input: n });
  });
  it('rejects wrong type for regexMatch input key', () => {
    // @ts-expect-error — input requires StringField, not DateField
    fn.regexMatch({ input: dt, regex: s });
  });
});

describe('array helpers', () => {
  it('rejects wrong type for zip inputs key', () => {
    // @ts-expect-error — inputs requires ArrayField[], not StringField
    fn.zip({ inputs: s });
  });
});

describe('type helpers', () => {
  it('convert accepts NumericField for to', () => {
    expectTypeOf(fn.convert({ input: d, to: n })).toEqualTypeOf<TypedAggExpr<DocField>>();
  });

  it('rejects wrong type for convert to key', () => {
    // @ts-expect-error — to requires StringField | NumericField, not DateField
    fn.convert({ input: d, to: dt });
  });
});

describe('object helpers', () => {
  it('getField accepts optional input', () => {
    expectTypeOf(fn.getField({ field: s })).toEqualTypeOf<TypedAggExpr<DocField>>();
  });

  it('rejects wrong type for getField field key', () => {
    // @ts-expect-error — field requires StringField, not NumericField
    fn.getField({ field: n });
  });
  it('rejects wrong type for setField field key', () => {
    // @ts-expect-error — field requires StringField, not BooleanField
    fn.setField({ field: b, input: d, value: d });
  });
});

describe('literal type inference', () => {
  it('infers StringField from string value', () => {
    expectTypeOf(fn.literal('hello')).toEqualTypeOf<TypedAggExpr<StringField>>();
  });
  it('infers NumericField from number value', () => {
    expectTypeOf(fn.literal(42)).toEqualTypeOf<TypedAggExpr<NumericField>>();
  });
  it('infers BooleanField from boolean value', () => {
    expectTypeOf(fn.literal(true)).toEqualTypeOf<TypedAggExpr<BooleanField>>();
  });
  it('infers DateField from Date value', () => {
    expectTypeOf(fn.literal(new Date())).toEqualTypeOf<TypedAggExpr<DateField>>();
  });

  it('contextual inference constrains value — string literal in StringField position', () => {
    expectTypeOf(fn.dateToString({ date: dt, format: fn.literal('%Y-%m-%d') })).toEqualTypeOf<
      TypedAggExpr<StringField>
    >();
  });

  it('rejects wrong value type in contextual position', () => {
    // @ts-expect-error — format expects StringField, but 42 infers NumericField
    fn.dateToString({ date: dt, format: fn.literal(42) });
  });

  it('allows explicit generic for custom field types', () => {
    type CustomField = { readonly codecId: 'custom/bigint@1'; readonly nullable: false };
    const custom = fn.literal<CustomField>(42n);
    expectTypeOf(custom).toEqualTypeOf<TypedAggExpr<CustomField>>();
  });
});

describe('date helpers on every codec stored as a BSON date', () => {
  const field = <CodecId extends string>(codecId: CodecId) =>
    ({ _field: { codecId, nullable: false } }) as TypedAggExpr<{
      readonly codecId: CodecId;
      readonly nullable: false;
    }>;

  it('take an instant or a calendar date field in any representation', () => {
    for (const date of [
      field('mongo/date@1'),
      field('mongo/date-instant@1'),
      field('mongo/date-instant-string@1'),
      field('mongo/date-string@1'),
      field('mongo/date-temporal@1'),
    ]) {
      expectTypeOf(fn.dateTrunc({ date, unit: s })).toEqualTypeOf<TypedAggExpr<DateField>>();
      expectTypeOf(fn.dateDiff({ startDate: date, endDate: dt, unit: s })).toEqualTypeOf<
        TypedAggExpr<NumericField>
      >();
      expectTypeOf(fn.dateToString({ date })).toEqualTypeOf<TypedAggExpr<StringField>>();
    }
  });

  it('refuse a field stored as a BSON string', () => {
    // @ts-expect-error a time of day is stored as a BSON string, not a BSON date
    fn.dateTrunc({ date: field('mongo/time-string@1'), unit: s });
  });
});
