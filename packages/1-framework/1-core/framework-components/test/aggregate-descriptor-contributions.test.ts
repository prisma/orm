import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { collectAggregateDescriptors } from '../src/control/control-stack';
import type { AggregateDescriptor } from '../src/shared/aggregate-descriptor';
import { aggregateDescriptorKey, isAggregateDescriptor } from '../src/shared/aggregate-descriptor';
import type { ComponentMetadata } from '../src/shared/framework-components';

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

function contributor(
  id: string,
  aggregateDescriptors: ReadonlyArray<AggregateDescriptor>,
): Pick<ComponentMetadata, 'types'> & { readonly id: string } {
  return { id, types: { aggregateDescriptors } };
}

const countRows: AggregateDescriptor = {
  operation: 'count',
  input: { kind: 'none' },
  output: { kind: 'codec', codecId: 'lib/int8@1' },
  nullable: false,
  emptyResultWire: '0',
};

const sumIntegers: AggregateDescriptor = {
  operation: 'sum',
  input: { kind: 'trait', trait: 'numeric' },
  output: { kind: 'codec', codecId: 'lib/int8@1' },
  nullable: true,
};

const maxSelf: AggregateDescriptor = {
  operation: 'max',
  input: { kind: 'trait', trait: 'order' },
  output: { kind: 'self' },
  nullable: true,
};

describe('aggregateDescriptorKey', () => {
  it('keys a no-input operation by its operation alone', () => {
    expect(aggregateDescriptorKey(countRows)).toBe('count:none');
  });

  it('keys an exact codec match by operation and codec id', () => {
    expect(
      aggregateDescriptorKey({ ...sumIntegers, input: { kind: 'codec', codecId: 'lib/int4@1' } }),
    ).toBe('sum:codec:lib/int4@1');
  });

  it('keys an input-agnostic match by operation alone', () => {
    expect(aggregateDescriptorKey({ ...countRows, input: { kind: 'any' } })).toBe('count:any');
  });

  it('keys a trait match by operation and trait', () => {
    expect(aggregateDescriptorKey(sumIntegers)).toBe('sum:trait:numeric');
  });

  it('separates an exact match from a trait match on the same operation', () => {
    expect(aggregateDescriptorKey(sumIntegers)).not.toBe(
      aggregateDescriptorKey({ ...sumIntegers, input: { kind: 'codec', codecId: 'numeric' } }),
    );
  });
});

describe('isAggregateDescriptor', () => {
  it('accepts a complete descriptor', () => {
    expect(isAggregateDescriptor(countRows)).toBe(true);
  });

  it('accepts an input-agnostic match', () => {
    expect(isAggregateDescriptor({ ...countRows, input: { kind: 'any' } })).toBe(true);
  });

  it('rejects a self output on an operation that consumes no input', () => {
    expect(isAggregateDescriptor({ ...countRows, output: { kind: 'self' } })).toBe(false);
  });

  it('rejects a self output on an input-agnostic match, which may have no input to reuse', () => {
    expect(
      isAggregateDescriptor({ ...countRows, input: { kind: 'any' }, output: { kind: 'self' } }),
    ).toBe(false);
  });

  it('rejects an unknown input match kind', () => {
    expect(isAggregateDescriptor({ ...countRows, input: { kind: 'anything' } })).toBe(false);
  });

  it('rejects an unknown trait', () => {
    expect(
      isAggregateDescriptor({ ...sumIntegers, input: { kind: 'trait', trait: 'numric' } }),
    ).toBe(false);
  });

  it('rejects a non-function type-parameter resolver', () => {
    expect(
      isAggregateDescriptor({
        ...countRows,
        output: { kind: 'codec', codecId: 'lib/int8@1', typeParams: { precision: 10 } },
      }),
    ).toBe(false);
  });

  it('rejects a missing operation', () => {
    expect(isAggregateDescriptor({ ...countRows, operation: '' })).toBe(false);
  });

  it('rejects a non-boolean nullability declaration', () => {
    expect(isAggregateDescriptor({ ...countRows, nullable: 'yes' })).toBe(false);
  });
});

describe('collectAggregateDescriptors', () => {
  it('collects descriptors across contributors', () => {
    const collected = collectAggregateDescriptors([
      contributor('target', [countRows]),
      contributor('extension', [sumIntegers, maxSelf]),
    ]);

    expect(collected).toEqual([countRows, sumIntegers, maxSelf]);
  });

  it('returns an empty list when no contributor declares aggregates', () => {
    expect(collectAggregateDescriptors([{ id: 'target' }])).toEqual([]);
  });

  it('accepts the same operation contributed for different inputs', () => {
    const exact: AggregateDescriptor = {
      ...sumIntegers,
      input: { kind: 'codec', codecId: 'lib/int8@1' },
      output: { kind: 'codec', codecId: 'lib/numeric@1' },
    };

    expect(collectAggregateDescriptors([contributor('target', [sumIntegers, exact])])).toEqual([
      sumIntegers,
      exact,
    ]);
  });

  it('rejects two contributors claiming the same operation and input with a structured error', () => {
    const error = capture(() =>
      collectAggregateDescriptors([
        contributor('target', [sumIntegers]),
        contributor('extension', [
          { ...sumIntegers, nullable: false as const, emptyResultWire: '0' },
        ]),
      ]),
    );

    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.AGGREGATE_DESCRIPTOR_DUPLICATE',
      message: expect.stringMatching(/Duplicate aggregate descriptor for "sum:trait:numeric"/),
      details: { key: 'sum:trait:numeric' },
    });
  });

  it('names both the conflicting contributor and the incumbent owner', () => {
    const error = capture(() =>
      collectAggregateDescriptors([
        contributor('target', [countRows]),
        contributor('extension', [countRows]),
      ]),
    );

    expect(error).toMatchObject({
      message: expect.stringMatching(/"extension" conflicts with "target"/),
      details: { contributedBy: 'extension', owner: 'target' },
    });
  });

  it('rejects a malformed contribution at collection time with a structured error', () => {
    const malformed = { operation: 'sum', input: { kind: 'trait' }, nullable: true };

    const error = capture(() =>
      collectAggregateDescriptors([
        {
          id: 'extension',
          types: {
            aggregateDescriptors: [malformed] as unknown as ReadonlyArray<AggregateDescriptor>,
          },
        },
      ]),
    );

    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.AGGREGATE_DESCRIPTOR_INVALID',
      message:
        'Malformed aggregate descriptor contributed by "extension". ' +
        'A descriptor declares a non-empty `operation`, an `input` match of kind `none`/`any`/`codec`/`trait`, ' +
        'an `output` of kind `self`/`codec`, and a boolean `nullable` — plus `emptyResultWire`, ' +
        'a wire value of the result codec, where `nullable` is false; a `self` output needs an input to reuse.',
      details: { contributedBy: 'extension', descriptor: malformed },
    });
  });

  it('names the missing empty result when a non-nullable descriptor omits it', () => {
    const withoutEmptyResult = {
      operation: 'count',
      input: { kind: 'none' },
      output: { kind: 'codec', codecId: 'lib/int8@1' },
      nullable: false,
    };

    const error = capture(() =>
      collectAggregateDescriptors([
        {
          id: 'extension',
          types: {
            aggregateDescriptors: [
              withoutEmptyResult,
            ] as unknown as ReadonlyArray<AggregateDescriptor>,
          },
        },
      ]),
    );

    expect(error).toMatchObject({
      code: 'CONTRACT.AGGREGATE_DESCRIPTOR_INVALID',
      message: expect.stringContaining('`emptyResultWire`'),
    });
  });
});
