import type { CodecTrait } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import type { SqlAggregateDescriptor } from '../src/aggregate-descriptor';
import { buildSqlAggregateDescriptorRegistry } from '../src/aggregate-descriptor-registry';
import type { AnyCodecDescriptor } from '../src/ast/codec-types';
import { LiteralExpr } from '../src/ast/types';
import { buildCodecDescriptorRegistry } from '../src/codec-descriptor-registry';

const codecStub = (codecId: string, traits: readonly CodecTrait[]): AnyCodecDescriptor =>
  ({
    codecId,
    traits,
    isParameterized: false,
    paramsSchema: undefined,
    factory: () => () => ({ id: codecId }) as never,
  }) as unknown as AnyCodecDescriptor;

const codecs = buildCodecDescriptorRegistry([
  codecStub('lib/int4@1', ['numeric', 'order', 'equality']),
  codecStub('lib/int8@1', ['numeric', 'order', 'equality']),
  codecStub('lib/numeric@1', ['numeric', 'order', 'equality']),
  codecStub('lib/text@1', ['textual', 'order', 'equality']),
]);

const countRows: SqlAggregateDescriptor = {
  operation: 'count',
  input: { kind: 'none' },
  output: { kind: 'codec', codecId: 'lib/int8@1' },
  nullable: false,
  emptyResultWire: '0',
};

const sumNumeric: SqlAggregateDescriptor = {
  operation: 'sum',
  input: { kind: 'trait', trait: 'numeric' },
  output: { kind: 'codec', codecId: 'lib/int8@1' },
  nullable: true,
};

const sumInt8: SqlAggregateDescriptor = {
  operation: 'sum',
  input: { kind: 'codec', codecId: 'lib/int8@1' },
  output: { kind: 'codec', codecId: 'lib/numeric@1' },
  nullable: true,
};

const maxOrdered: SqlAggregateDescriptor = {
  operation: 'max',
  input: { kind: 'trait', trait: 'order' },
  output: { kind: 'self' },
  nullable: true,
};

const countAnything: SqlAggregateDescriptor = {
  operation: 'count',
  input: { kind: 'any' },
  output: { kind: 'codec', codecId: 'lib/int8@1' },
  nullable: false,
  emptyResultWire: '0',
};

describe('buildSqlAggregateDescriptorRegistry — input-agnostic matching', () => {
  it('answers a call carrying no input', () => {
    const registry = buildSqlAggregateDescriptorRegistry([countAnything], codecs);

    expect(registry.resolve('count')).toEqual({
      operation: 'count',
      output: { codecId: 'lib/int8@1' },
      nullable: false,
      emptyResultWire: '0',
      lower: undefined,
    });
  });

  it('answers a call carrying any input codec', () => {
    const registry = buildSqlAggregateDescriptorRegistry([countAnything], codecs);

    expect(registry.resolve('count', { codecId: 'lib/text@1' })?.output).toEqual({
      codecId: 'lib/int8@1',
    });
    expect(registry.resolve('count', { codecId: 'ext/unregistered@1' })?.output).toEqual({
      codecId: 'lib/int8@1',
    });
  });

  it('yields to an exact codec match', () => {
    const registry = buildSqlAggregateDescriptorRegistry(
      [countAnything, { ...sumInt8, operation: 'count' }],
      codecs,
    );

    expect(registry.resolve('count', { codecId: 'lib/int8@1' })?.output).toEqual({
      codecId: 'lib/numeric@1',
    });
    expect(registry.resolve('count', { codecId: 'lib/int4@1' })?.output).toEqual({
      codecId: 'lib/int8@1',
    });
  });

  it('yields to a trait match', () => {
    const registry = buildSqlAggregateDescriptorRegistry(
      [countAnything, { ...sumNumeric, operation: 'count', output: { kind: 'self' } }],
      codecs,
    );

    expect(registry.resolve('count', { codecId: 'lib/int4@1' })?.output).toEqual({
      codecId: 'lib/int4@1',
    });
    expect(registry.resolve('count', { codecId: 'lib/text@1' })?.output).toEqual({
      codecId: 'lib/int8@1',
    });
  });

  it('yields to a no-input descriptor for a call carrying no input', () => {
    const registry = buildSqlAggregateDescriptorRegistry(
      [countAnything, { ...countRows, output: { kind: 'codec', codecId: 'lib/numeric@1' } }],
      codecs,
    );

    expect(registry.resolve('count')?.output).toEqual({ codecId: 'lib/numeric@1' });
    expect(registry.resolve('count', { codecId: 'lib/text@1' })?.output).toEqual({
      codecId: 'lib/int8@1',
    });
  });

  it('rejects a self output, there being no input it is guaranteed to have', () => {
    expect(() =>
      buildSqlAggregateDescriptorRegistry([{ ...countAnything, output: { kind: 'self' } }], codecs),
    ).toThrow(/is not a valid SQL aggregate descriptor/);
  });

  it('claims its own ownership key', () => {
    expect(() =>
      buildSqlAggregateDescriptorRegistry([countAnything, countRows], codecs),
    ).not.toThrow();
    expect(() =>
      buildSqlAggregateDescriptorRegistry([countAnything, { ...countAnything }], codecs),
    ).toThrow(/Duplicate aggregate descriptor for 'count:any'/);
  });
});

describe('buildSqlAggregateDescriptorRegistry — resolution', () => {
  it('resolves a no-input operation to its declared output codec', () => {
    const registry = buildSqlAggregateDescriptorRegistry([countRows], codecs);

    expect(registry.resolve('count')).toEqual({
      operation: 'count',
      output: { codecId: 'lib/int8@1' },
      nullable: false,
      emptyResultWire: '0',
      lower: undefined,
    });
  });

  it('resolves a trait match when no exact descriptor claims the input codec', () => {
    const registry = buildSqlAggregateDescriptorRegistry([sumNumeric, sumInt8], codecs);

    expect(registry.resolve('sum', { codecId: 'lib/int4@1' })?.output).toEqual({
      codecId: 'lib/int8@1',
    });
  });

  it('prefers an exact codec match over a trait match', () => {
    const registry = buildSqlAggregateDescriptorRegistry([sumNumeric, sumInt8], codecs);

    expect(registry.resolve('sum', { codecId: 'lib/int8@1' })?.output).toEqual({
      codecId: 'lib/numeric@1',
    });
  });

  it('prefers an exact codec match regardless of contribution order', () => {
    const registry = buildSqlAggregateDescriptorRegistry([sumInt8, sumNumeric], codecs);

    expect(registry.resolve('sum', { codecId: 'lib/int8@1' })?.output).toEqual({
      codecId: 'lib/numeric@1',
    });
  });

  it('matches an exact descriptor for a codec the codec registry does not know', () => {
    const registry = buildSqlAggregateDescriptorRegistry(
      [{ ...sumInt8, input: { kind: 'codec', codecId: 'ext/money@1' } }],
      codecs,
    );

    expect(registry.resolve('sum', { codecId: 'ext/money@1' })?.output).toEqual({
      codecId: 'lib/numeric@1',
    });
  });

  it('carries the declared nullability of the matched descriptor', () => {
    const registry = buildSqlAggregateDescriptorRegistry([countRows, sumNumeric], codecs);

    expect(registry.resolve('count')?.nullable).toBe(false);
    expect(registry.resolve('sum', { codecId: 'lib/int4@1' })?.nullable).toBe(true);
  });

  it('returns the input codec, type parameters included, for a self output', () => {
    const registry = buildSqlAggregateDescriptorRegistry([maxOrdered], codecs);

    expect(
      registry.resolve('max', { codecId: 'lib/numeric@1', typeParams: { precision: 10 } }),
    ).toEqual({
      operation: 'max',
      output: { codecId: 'lib/numeric@1', typeParams: { precision: 10 } },
      nullable: true,
      lower: undefined,
    });
  });

  it('resolves output type parameters from the input reference', () => {
    const registry = buildSqlAggregateDescriptorRegistry(
      [
        {
          ...sumNumeric,
          output: {
            kind: 'codec',
            codecId: 'lib/numeric@1',
            typeParams: (input: { typeParams?: unknown } | undefined) => input?.typeParams,
          },
        },
      ],
      codecs,
    );

    expect(
      registry.resolve('sum', { codecId: 'lib/int4@1', typeParams: { precision: 4 } })?.output,
    ).toEqual({ codecId: 'lib/numeric@1', typeParams: { precision: 4 } });
  });

  it('reports the declared output codec even when lowering builds an unrelated expression', () => {
    const lower = () => LiteralExpr.of('lowered');
    const registry = buildSqlAggregateDescriptorRegistry([{ ...sumNumeric, lower }], codecs);

    const resolved = registry.resolve('sum', { codecId: 'lib/int4@1' });

    expect(resolved?.output).toEqual({ codecId: 'lib/int8@1' });
    expect(resolved?.lower).toBe(lower);
  });

  it('returns undefined for an unregistered operation', () => {
    const registry = buildSqlAggregateDescriptorRegistry([countRows], codecs);

    expect(registry.resolve('stddev', { codecId: 'lib/int4@1' })).toBeUndefined();
  });

  it('returns undefined when no descriptor claims the input codec', () => {
    const registry = buildSqlAggregateDescriptorRegistry([sumNumeric], codecs);

    expect(registry.resolve('sum', { codecId: 'lib/text@1' })).toBeUndefined();
  });

  it('returns undefined when an operation requires an input and none is supplied', () => {
    const registry = buildSqlAggregateDescriptorRegistry([sumNumeric], codecs);

    expect(registry.resolve('sum')).toBeUndefined();
  });

  it('values() yields every validated descriptor', () => {
    const registry = buildSqlAggregateDescriptorRegistry([countRows, sumNumeric], codecs);

    expect([...registry.values()]).toEqual([countRows, sumNumeric]);
  });
});

describe('buildSqlAggregateDescriptorRegistry — contributed operation names', () => {
  const medianOverNumeric: SqlAggregateDescriptor = {
    operation: 'median',
    input: { kind: 'trait', trait: 'numeric' },
    output: { kind: 'codec', codecId: 'lib/numeric@1' },
    nullable: true,
  };

  it('accepts an operation outside the alphabet when its descriptor carries a lowering hook', () => {
    const lower = () => LiteralExpr.of('lowered');
    const registry = buildSqlAggregateDescriptorRegistry([{ ...medianOverNumeric, lower }], codecs);

    expect(registry.resolve('median', { codecId: 'lib/int4@1' })).toEqual({
      operation: 'median',
      output: { codecId: 'lib/numeric@1' },
      nullable: true,
      lower,
    });
  });

  it('rejects an operation outside the alphabet whose descriptor carries no lowering hook', () => {
    expect(() => buildSqlAggregateDescriptorRegistry([medianOverNumeric], codecs)).toThrow(
      /outside the SQL aggregate alphabet .* carries no lowering hook/,
    );
  });

  it('requires no lowering hook for an operation in the alphabet', () => {
    const registry = buildSqlAggregateDescriptorRegistry([sumNumeric], codecs);

    expect(registry.resolve('sum', { codecId: 'lib/int4@1' })).toEqual({
      operation: 'sum',
      output: { codecId: 'lib/int8@1' },
      nullable: true,
      lower: undefined,
    });
  });

  it('enforces the lowering rule per descriptor, not per operation', () => {
    const lower = () => LiteralExpr.of('lowered');
    expect(() =>
      buildSqlAggregateDescriptorRegistry(
        [
          { ...medianOverNumeric, lower },
          { ...medianOverNumeric, input: { kind: 'trait', trait: 'order' } },
        ],
        codecs,
      ),
    ).toThrow(/outside the SQL aggregate alphabet .* carries no lowering hook/);
  });

  it('resolves a contributed operation that consumes no input', () => {
    const lower = () => LiteralExpr.of('lowered');
    const registry = buildSqlAggregateDescriptorRegistry(
      [
        {
          operation: 'tally',
          input: { kind: 'none' },
          output: { kind: 'codec', codecId: 'lib/int8@1' },
          nullable: false,
          emptyResultWire: '0',
          lower,
        },
      ],
      codecs,
    );

    expect(registry.resolve('tally')).toEqual({
      operation: 'tally',
      output: { codecId: 'lib/int8@1' },
      nullable: false,
      emptyResultWire: '0',
      lower,
    });
  });

  it('keeps exact-over-trait-over-any precedence for a contributed operation', () => {
    const lowerAny = () => LiteralExpr.of('any');
    const lowerTrait = () => LiteralExpr.of('trait');
    const lowerExact = () => LiteralExpr.of('exact');
    const registry = buildSqlAggregateDescriptorRegistry(
      [
        {
          operation: 'median',
          input: { kind: 'any' },
          output: { kind: 'codec', codecId: 'lib/int8@1' },
          nullable: true,
          lower: lowerAny,
        },
        { ...medianOverNumeric, lower: lowerTrait },
        {
          operation: 'median',
          input: { kind: 'codec', codecId: 'lib/int8@1' },
          output: { kind: 'codec', codecId: 'lib/numeric@1' },
          nullable: true,
          lower: lowerExact,
        },
      ],
      codecs,
    );

    expect(registry.resolve('median', { codecId: 'lib/int8@1' })).toEqual({
      operation: 'median',
      output: { codecId: 'lib/numeric@1' },
      nullable: true,
      lower: lowerExact,
    });
    expect(registry.resolve('median', { codecId: 'lib/int4@1' })).toEqual({
      operation: 'median',
      output: { codecId: 'lib/numeric@1' },
      nullable: true,
      lower: lowerTrait,
    });
    expect(registry.resolve('median', { codecId: 'lib/text@1' })).toEqual({
      operation: 'median',
      output: { codecId: 'lib/int8@1' },
      nullable: true,
      lower: lowerAny,
    });
  });
});

describe('buildSqlAggregateDescriptorRegistry — composition-time validation', () => {
  it('rejects a duplicate operation and input pair', () => {
    expect(() =>
      buildSqlAggregateDescriptorRegistry(
        [sumNumeric, { ...sumNumeric, nullable: false, emptyResultWire: '0' }],
        codecs,
      ),
    ).toThrow(/Duplicate aggregate descriptor for 'sum:trait:numeric'/);
  });

  it('rejects a malformed contribution', () => {
    expect(() =>
      buildSqlAggregateDescriptorRegistry([{ operation: 'sum', nullable: true }], codecs),
    ).toThrow(/is not a valid SQL aggregate descriptor/);
  });

  // A non-nullable result is one the caller reads without a null check, so the
  // value it reads where no row arrived has to come from somewhere. The row
  // declares it; a row that declares none has no answer to give.
  it('rejects a non-nullable row that declares no empty result', () => {
    expect(() =>
      buildSqlAggregateDescriptorRegistry([{ ...countRows, emptyResultWire: undefined }], codecs),
    ).toThrow(/is not a valid SQL aggregate descriptor/);
  });

  it('rejects a non-function lowering hook', () => {
    expect(() =>
      buildSqlAggregateDescriptorRegistry([{ ...sumNumeric, lower: 'sum(x)' }], codecs),
    ).toThrow(/is not a valid SQL aggregate descriptor/);
  });

  it('rejects a named output codec the composed stack does not register', () => {
    expect(() =>
      buildSqlAggregateDescriptorRegistry(
        [{ ...sumNumeric, output: { kind: 'codec', codecId: 'lib/missing@1' } }],
        codecs,
      ),
    ).toThrow(/names result codec 'lib\/missing@1', which the composed stack does not register/);
  });

  it('rejects a self output over an exact input the composed stack does not register', () => {
    expect(() =>
      buildSqlAggregateDescriptorRegistry(
        [
          {
            operation: 'max',
            input: { kind: 'codec', codecId: 'ext/money@1' },
            output: { kind: 'self' },
            nullable: true,
          },
        ],
        codecs,
      ),
    ).toThrow(/names result codec 'ext\/money@1', which the composed stack does not register/);
  });

  it('rejects two trait descriptors that both claim a registered codec', () => {
    expect(() =>
      buildSqlAggregateDescriptorRegistry(
        [sumNumeric, { ...sumNumeric, input: { kind: 'trait', trait: 'order' } }],
        codecs,
      ),
    ).toThrow(/Ambiguous aggregate descriptors for 'sum' over codec 'lib\/int4@1'/);
  });

  it('accepts overlapping traits when an exact descriptor settles every affected codec', () => {
    const registry = buildSqlAggregateDescriptorRegistry(
      [
        { ...sumNumeric, input: { kind: 'trait', trait: 'textual' } },
        { ...sumNumeric, input: { kind: 'trait', trait: 'order' } },
        { ...sumInt8, input: { kind: 'codec', codecId: 'lib/text@1' } },
      ],
      buildCodecDescriptorRegistry([
        codecStub('lib/text@1', ['textual', 'order']),
        codecStub('lib/int8@1', ['numeric']),
        codecStub('lib/numeric@1', ['numeric']),
      ]),
    );

    expect(registry.resolve('sum', { codecId: 'lib/text@1' })?.output).toEqual({
      codecId: 'lib/numeric@1',
    });
  });
});
