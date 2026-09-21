import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal } from '../src/interpreter';
import {
  postgresScalarTypeDescriptors,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPslDocumentToSqlContract,
  postgresTemporalContributions,
  sqliteTemporalContributions,
} from './interpreter-defaults-support';
import { unboundTables } from './unbound-tables';

// Whole column shapes and whole execution-defaults lists are asserted here,
// not spot fields: which keys are absent is as much a part of the lowering
// contract as which are present. `temporal.timestamp()` must omit
// `typeParams` entirely, and a preset with no phase token must omit
// `executionDefaults` entirely rather than emit an empty object.
describe('temporal per-codec preset lowering', () => {
  const interpretTemporal = (schema: string) => {
    const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
    return interpretPslDocumentToSqlContract({
      ...document,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: postgresTemporalContributions,
    });
  };

  const columnAndDefaults = (schema: string) => {
    const result = interpretTemporal(schema);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('interpretation failed');
    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    return {
      column: unboundTables(storage)['T']?.columns['stamped'],
      defaults: result.value.execution?.mutations.defaults ?? [],
    };
  };

  const model = (field: string) => `model T {
id Int @id
stamped ${field}
}`;

  const pgTimestampPrecision3 = {
    nativeType: 'timestamp',
    codecId: 'pg/timestamp-temporal@1',
    nullable: false,
    typeParams: { precision: 3 },
  };
  const stampedRef = { namespace: 'public', table: 'T', column: 'stamped' };
  const nowPhase = { kind: 'generator', id: 'timestampNow' };

  it('timestamp(3, onCreate: now, onUpdate: now) yields precision 3 and both phases', () => {
    const { column, defaults } = columnAndDefaults(
      model('temporal.timestamp(3, onCreate: now, onUpdate: now)'),
    );
    expect(column).toEqual(pgTimestampPrecision3);
    expect(defaults).toEqual([{ ref: stampedRef, onCreate: nowPhase, onUpdate: nowPhase }]);
  });

  it('timestamp(3) yields precision 3 and no execution defaults at all', () => {
    const { column, defaults } = columnAndDefaults(model('temporal.timestamp(3)'));
    expect(column).toEqual(pgTimestampPrecision3);
    expect(defaults).toEqual([]);
  });

  it('timestamp() omits the typeParams key entirely and has no execution defaults', () => {
    const { column, defaults } = columnAndDefaults(model('temporal.timestamp()'));
    expect(column).toEqual({
      nativeType: 'timestamp',
      codecId: 'pg/timestamp-temporal@1',
      nullable: false,
    });
    expect(column).not.toHaveProperty('typeParams');
    expect(defaults).toEqual([]);
  });

  it('timestamptz(onCreate: now, onUpdate: now) yields both phases and no typeParams', () => {
    const { column, defaults } = columnAndDefaults(
      model('temporal.timestamptz(onCreate: now, onUpdate: now)'),
    );
    expect(column).toEqual({
      nativeType: 'timestamptz',
      codecId: 'pg/timestamptz-temporal@1',
      nullable: false,
    });
    expect(defaults).toEqual([{ ref: stampedRef, onCreate: nowPhase, onUpdate: nowPhase }]);
  });

  it('timestamptz(onUpdate: now) yields the onUpdate phase only', () => {
    const { column, defaults } = columnAndDefaults(model('temporal.timestamptz(onUpdate: now)'));
    expect(column).toEqual({
      nativeType: 'timestamptz',
      codecId: 'pg/timestamptz-temporal@1',
      nullable: false,
    });
    expect(defaults).toEqual([{ ref: stampedRef, onUpdate: nowPhase }]);
  });

  it('updatedAt() is byte-identical to timestamptz(onCreate: now, onUpdate: now)', () => {
    const convenience = columnAndDefaults(model('temporal.updatedAt()'));
    const full = columnAndDefaults(model('temporal.timestamptz(onCreate: now, onUpdate: now)'));
    expect(convenience).toEqual(full);
  });

  it('accepts precision named as well as positional, lowering identically', () => {
    expect(columnAndDefaults(model('temporal.timestamp(precision: 3)'))).toEqual(
      columnAndDefaults(model('temporal.timestamp(3)')),
    );
    expect(
      columnAndDefaults(model('temporal.timestamp(precision: 3, onCreate: now, onUpdate: now)')),
    ).toEqual(columnAndDefaults(model('temporal.timestamp(3, onCreate: now, onUpdate: now)')));
  });

  it('lowers sqlite temporal.datetime(onCreate: now, onUpdate: now) to the sqlite codec', () => {
    const document = symbolTableInputFromParseArgs({
      schema: model('temporal.datetime(onCreate: now, onUpdate: now)'),
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContractInternal({
      ...document,
      target: sqliteTarget,
      scalarColumnDescriptors: sqliteScalarColumnDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: sqliteTemporalContributions,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['T']?.columns['stamped']).toEqual({
      nativeType: 'text',
      codecId: 'sqlite/datetime@1',
      nullable: false,
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: '__unbound__', table: 'T', column: 'stamped' },
        onCreate: nowPhase,
        onUpdate: nowPhase,
      },
    ]);
  });

  // Every bad-argument spelling reports through the existing
  // PSL_INVALID_ATTRIBUTE_ARGUMENT plumbing; the option kind introduces no
  // diagnostic code of its own.
  it.each([
    {
      name: 'an option value outside the descriptor values',
      field: 'temporal.timestamp(onCreate: later)',
      message: /must be one of: now/,
    },
    {
      name: 'a quoted option value (one spelling only)',
      field: 'temporal.timestamp(onCreate: "now")',
      message: /cannot parse named argument "onCreate" for descriptor kind "option"/,
    },
    {
      name: 'a duplicate named argument',
      field: 'temporal.timestamp(precision: 3, precision: 4)',
      message: /received duplicate value for argument "precision"/,
    },
    {
      name: 'a positional argument the same named argument also supplies',
      field: 'temporal.timestamp(3, precision: 4)',
      message: /received duplicate value for argument "precision"/,
    },
    {
      name: 'an unknown named argument',
      field: 'temporal.timestamp(frequency: now)',
      message: /received unknown named argument "frequency"/,
    },
  ])('rejects $name', ({ field, message }) => {
    const result = interpretTemporal(model(field));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringMatching(message),
        }),
      ]),
    );
  });
});
