import type { AggregateDescriptor } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';

const CONTRIBUTED = [
  { codecId: 'pg/int2@1', traits: ['numeric', 'order'] },
  { codecId: 'pg/int8@1', traits: ['numeric', 'order'] },
  { codecId: 'pg/text@1', traits: ['textual', 'order'] },
  { codecId: 'pg/varchar@1', traits: ['textual', 'order'] },
];

const COUNT: AggregateDescriptor = {
  operation: 'count',
  input: { kind: 'any' },
  output: { kind: 'codec', codecId: 'pg/int8@1' },
  nullable: false,
  emptyResultWire: '0',
};

const SUM_INT2: AggregateDescriptor = {
  operation: 'sum',
  input: { kind: 'codec', codecId: 'pg/int2@1' },
  output: { kind: 'codec', codecId: 'pg/int8@1' },
  nullable: true,
};

const MIN_TEXTUAL: AggregateDescriptor = {
  operation: 'min',
  input: { kind: 'trait', trait: 'textual' },
  output: { kind: 'self' },
  nullable: true,
};

const MIN_VARCHAR: AggregateDescriptor = {
  operation: 'min',
  input: { kind: 'codec', codecId: 'pg/varchar@1' },
  output: { kind: 'codec', codecId: 'pg/text@1' },
  nullable: true,
};

function aggregateTypesFor(options: {
  aggregateDescriptors: ReadonlyArray<AggregateDescriptor>;
  codecDescriptors: ReadonlyArray<{ readonly codecId: string; readonly traits: readonly string[] }>;
}): string {
  const aliases = sqlEmission.getFamilyTypeAliases({
    aggregateDescriptors: options.aggregateDescriptors,
    codecDescriptors: options.codecDescriptors as never,
  });
  const line = aliases.split('\n').find((entry) => entry.startsWith('export type AggregateTypes'));
  if (line === undefined) throw new Error(`no AggregateTypes alias in:\n${aliases}`);
  return line;
}

describe('emitted AggregateTypes', () => {
  it('is empty when the stack contributes no aggregate overloads', () => {
    expect(aggregateTypesFor({ aggregateDescriptors: [], codecDescriptors: CONTRIBUTED })).toBe(
      'export type AggregateTypes = Record<string, never>;',
    );
  });

  it('carries an exact overload as its own row', () => {
    const emitted = aggregateTypesFor({
      aggregateDescriptors: [SUM_INT2],
      codecDescriptors: CONTRIBUTED,
    });

    expect(emitted).toContain(
      'readonly "pg/int2@1": { readonly output: "pg/int8@1"; readonly nullable: true }',
    );
  });

  it('expands a trait overload over the codecs that carry the trait', () => {
    const emitted = aggregateTypesFor({
      aggregateDescriptors: [MIN_TEXTUAL],
      codecDescriptors: CONTRIBUTED,
    });

    expect(emitted).toContain(
      'readonly "pg/text@1": { readonly output: "pg/text@1"; readonly nullable: true }',
    );
    expect(emitted).not.toContain('readonly "pg/int2@1"');
  });

  it('lets an exact overload shadow the trait fallback that would otherwise serve the codec', () => {
    const emitted = aggregateTypesFor({
      aggregateDescriptors: [MIN_TEXTUAL, MIN_VARCHAR],
      codecDescriptors: CONTRIBUTED,
    });

    expect(emitted).toContain(
      'readonly "pg/varchar@1": { readonly output: "pg/text@1"; readonly nullable: true }',
    );
  });

  it('leaves the input-agnostic overload as one row rather than one per codec', () => {
    const emitted = aggregateTypesFor({
      aggregateDescriptors: [COUNT],
      codecDescriptors: CONTRIBUTED,
    });

    expect(emitted).toContain(
      'readonly count: { readonly byCodec: {  }; readonly withoutInput: { readonly output: "pg/int8@1"; readonly nullable: false }; readonly anyInput: { readonly output: "pg/int8@1"; readonly nullable: false } }',
    );
  });

  // The SQLite adapter registers eleven codecs with its target and contributes
  // nine: the two it withholds have emitted type names it cannot resolve. A map
  // built from the target's registry would type `min` over those two, and the
  // runtime — which resolves against the contributed set — would not honour it.
  it('serves no codec the stack does not contribute, however wide the trait', () => {
    const emitted = aggregateTypesFor({
      aggregateDescriptors: [MIN_TEXTUAL],
      codecDescriptors: CONTRIBUTED.filter((entry) => entry.codecId !== 'pg/varchar@1'),
    });

    expect(emitted).toContain('readonly "pg/text@1"');
    expect(emitted).not.toContain('pg/varchar@1');
  });

  it('emits several operations in name order', () => {
    const emitted = aggregateTypesFor({
      aggregateDescriptors: [SUM_INT2, COUNT, MIN_TEXTUAL],
      codecDescriptors: CONTRIBUTED,
    });

    const positions = ['readonly count:', 'readonly min:', 'readonly sum:'].map((key) =>
      emitted.indexOf(key),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('refuses to emit a result type for a codec two traits both claim', () => {
    expect(() =>
      aggregateTypesFor({
        aggregateDescriptors: [
          MIN_TEXTUAL,
          { ...MIN_TEXTUAL, input: { kind: 'trait', trait: 'order' } },
        ],
        codecDescriptors: CONTRIBUTED,
      }),
    ).toThrow(/has no single result type over codec/);
  });

  it('refuses to emit a row whose result codec the stack does not contribute', () => {
    expect(() =>
      aggregateTypesFor({
        aggregateDescriptors: [{ ...SUM_INT2, output: { kind: 'codec', codecId: 'pg/missing@1' } }],
        codecDescriptors: CONTRIBUTED,
      }),
    ).toThrow(/names result codec 'pg\/missing@1', which the stack does not contribute/);
  });
});
