import type { CodecTrait } from '@internal/framework-components/codec';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import type { SqlAggregateDescriptor } from '../src/aggregate-descriptor';
import { buildSqlAggregateDescriptorRegistry } from '../src/aggregate-descriptor-registry';
import type { AnyCodecDescriptor } from '../src/ast/codec-types';
import { buildCodecDescriptorRegistry } from '../src/codec-descriptor-registry';
import { AggregateExpr, LiteralColumnDefault, sqlCharRenderOutputType } from '../src/exports/ast';

const stub = (codecId: string, targetTypes: readonly string[]): AnyCodecDescriptor =>
  ({
    codecId,
    traits: [],
    targetTypes,
    isParameterized: false,
    paramsSchema: undefined,
    factory: () => () => ({ id: codecId }) as never,
  }) as unknown as AnyCodecDescriptor;

const codecWithTraits = (codecId: string, traits: readonly CodecTrait[]): AnyCodecDescriptor =>
  ({ ...stub(codecId, []), traits }) as unknown as AnyCodecDescriptor;

const sumOverNumeric: SqlAggregateDescriptor = {
  operation: 'sum',
  input: { kind: 'trait', trait: 'numeric' },
  output: { kind: 'codec', codecId: 'lib/int8@1' },
  nullable: true,
};

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('relational-core structured error codes', () => {
  it('duplicate codec descriptor id raises RUNTIME.DUPLICATE_CODEC', () => {
    const error = capture(() =>
      buildCodecDescriptorRegistry([stub('lib/dup@1', ['ta']), stub('lib/dup@1', ['tb'])]),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.DUPLICATE_CODEC',
      meta: { codecId: 'lib/dup@1' },
    });
  });

  it('malformed aggregate descriptor raises RUNTIME.AGGREGATE_DESCRIPTOR_INVALID', () => {
    const error = capture(() =>
      buildSqlAggregateDescriptorRegistry(
        [{ operation: 'sum', nullable: true }],
        buildCodecDescriptorRegistry([]),
      ),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.AGGREGATE_DESCRIPTOR_INVALID',
      meta: { descriptor: "'sum'" },
    });
  });

  it('twice-claimed aggregate overload raises RUNTIME.DUPLICATE_AGGREGATE_DESCRIPTOR', () => {
    const error = capture(() =>
      buildSqlAggregateDescriptorRegistry(
        [sumOverNumeric, { ...sumOverNumeric, nullable: false, emptyResultJson: '0' }],
        buildCodecDescriptorRegistry([]),
      ),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.DUPLICATE_AGGREGATE_DESCRIPTOR',
      meta: { key: 'sum:trait:numeric' },
    });
  });

  it('overlapping aggregate traits raise RUNTIME.AMBIGUOUS_AGGREGATE_DESCRIPTOR', () => {
    const error = capture(() =>
      buildSqlAggregateDescriptorRegistry(
        [sumOverNumeric, { ...sumOverNumeric, input: { kind: 'trait', trait: 'order' } }],
        buildCodecDescriptorRegistry([codecWithTraits('lib/int@1', ['numeric', 'order'])]),
      ),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.AMBIGUOUS_AGGREGATE_DESCRIPTOR',
      meta: { operation: 'sum', codecId: 'lib/int@1', traits: ['numeric', 'order'] },
    });
  });

  it('alphabet-external operation without a lowering hook raises RUNTIME.AGGREGATE_LOWERING_MISSING', () => {
    const error = capture(() =>
      buildSqlAggregateDescriptorRegistry(
        [{ ...sumOverNumeric, operation: 'median' }],
        buildCodecDescriptorRegistry([codecWithTraits('lib/int8@1', ['numeric'])]),
      ),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.AGGREGATE_LOWERING_MISSING',
      meta: { operation: 'median', key: 'median:trait:numeric' },
    });
  });

  it('unregistered aggregate output codec raises RUNTIME.AGGREGATE_OUTPUT_CODEC_MISSING', () => {
    const error = capture(() =>
      buildSqlAggregateDescriptorRegistry([sumOverNumeric], buildCodecDescriptorRegistry([])),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.AGGREGATE_OUTPUT_CODEC_MISSING',
      meta: { operation: 'sum', key: 'sum:trait:numeric', outputCodecId: 'lib/int8@1' },
    });
  });

  it('aggregate function without expression raises ORM.ARGUMENT_INVALID', () => {
    const error = capture(() => new AggregateExpr('sum'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message: 'Aggregate function "sum" requires an expression',
      meta: { fn: 'sum' },
    });
  });

  it('non-integer length typeParams raises RUNTIME.TYPE_PARAMS_INVALID', () => {
    const error = capture(() => sqlCharRenderOutputType({ length: 1.5 }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.TYPE_PARAMS_INVALID',
      meta: { codec: 'sql/char@1', param: 'length', received: '1.5' },
    });
  });

  it('invalid column default literal raises CONTRACT.DEFAULT_INVALID', () => {
    const error = capture(() => new LiteralColumnDefault(Symbol('x') as unknown as string));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.DEFAULT_INVALID',
      message: 'Invalid column default literal value',
    });
  });
});
