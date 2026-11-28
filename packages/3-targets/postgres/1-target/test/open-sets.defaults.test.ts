import type { SqlPslBuildContext } from '@internal/family-sql/control';
import { describe, expect, it, vi } from 'vitest';
import { describeFullTextIndexProblem } from '../src/core/full-text-index-definition';
import { buildGeneratorAttributes } from '../src/core/psl-print/generated-values';
import { postgresNodeEntityKind } from '../src/core/schema-ir/schema-node-kinds';

vi.mock('@internal/family-sql/psl-build', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generatorCallsFor: () => ({
    ok: false,
    refusal: {
      kind: '%future added value',
      phase: 'onCreate',
      generator: { kind: 'generator', id: 'uuidv7' },
    },
  }),
}));

vi.mock('@internal/sql-contract/data-type', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sqlCodecColumnLength: () => undefined,
}));

describe('defaults over sets a later release may add to', () => {
  it('words a full-text index problem of a kind it does not know by the kind', () => {
    expect(describeFullTextIndexProblem('The index', { kind: '%future added value' })).toBe(
      'The index breaks a full-text index rule this version does not name ("%future added value").',
    );
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'maps the node kind %s, an inherited property name, to no entity',
    (kind) => {
      expect(postgresNodeEntityKind(kind)).toBeUndefined();
    },
  );

  it('treats a generator refusal of a kind it does not know as a bug of the release', () => {
    expect(() =>
      buildGeneratorAttributes({
        executionDefault: {
          ref: { namespace: 'public', entry: 'User', field: 'id' },
          onCreate: { kind: 'generator', id: 'uuidv7' },
        },
        codecId: 'pg/uuid@1',
        list: false,
        typeParams: undefined,
        coordinate: 'User.id',
        context: { dataTypes: undefined } as unknown as SqlPslBuildContext,
      }),
    ).toThrow(/words every generator refusal of its own release/);
  });
});
