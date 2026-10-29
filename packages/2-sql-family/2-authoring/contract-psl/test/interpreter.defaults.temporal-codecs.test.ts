import { describe, expect, it } from 'vitest';
import { postgresScalarAuthoringTypes, postgresScalarTypeDescriptors } from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
} from './interpreter-defaults-support';
import { unboundTables } from './unbound-tables';

// Whole column shapes and whole execution-defaults lists are asserted here: which keys are absent is as much a part of the lowering as which are present.
describe('a temporal type constructor with generator attributes', () => {
  const interpretTemporal = (schema: string) =>
    interpretPostgresSchema(schema, {
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: { type: postgresScalarAuthoringTypes },
    });

  const columnAndDefaults = (schema: string) => {
    const result = interpretTemporal(schema);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    return {
      column: unboundTables(storage)['T']?.columns['stamped'],
      defaults: result.value.execution?.mutations.defaults,
    };
  };

  const model = (field: string) => `model T {
id Int @id
stamped ${field}
}`;

  const timestamp = {
    many: false,
    dataType: 'pg/timestamp',
    codecId: 'pg/timestamp-temporal@1',
    nullable: false,
  };
  const timestamptz = {
    many: false,
    dataType: 'pg/timestamptz',
    codecId: 'pg/timestamptz-temporal@1',
    nullable: false,
  };
  const stampedRef = { namespace: 'public', entry: 'T', field: 'stamped' };
  const plainDateTimeNow = { kind: 'generator', id: 'plainDateTimeNow' };
  const instantNow = { kind: 'generator', id: 'instantNow' };

  it('TimestampTemporal(3) with both phases stores precision 3 and both generators', () => {
    expect(
      columnAndDefaults(model('TimestampTemporal(3) @onCreate(now()) @onUpdate(now())')),
    ).toEqual({
      column: { ...timestamp, typeParams: { precision: 3 } },
      defaults: [
        {
          ref: stampedRef,
          onCreate: { ...plainDateTimeNow, params: { precision: 3 } },
          onUpdate: { ...plainDateTimeNow, params: { precision: 3 } },
        },
      ],
    });
  });

  it('TimestampTemporal(3) with no generator attribute stores no execution entry', () => {
    expect(columnAndDefaults(model('TimestampTemporal(3)'))).toEqual({
      column: { ...timestamp, typeParams: { precision: 3 } },
      defaults: undefined,
    });
  });

  it('TimestampTemporal with no arguments stores no typeParams', () => {
    const { column } = columnAndDefaults(model('TimestampTemporal'));
    expect(column).toEqual(timestamp);
    expect(column).not.toHaveProperty('typeParams');
  });

  it('TimestamptzTemporal with only @onUpdate stores the onUpdate generator only', () => {
    expect(columnAndDefaults(model('TimestamptzTemporal @onUpdate(now())'))).toEqual({
      column: timestamptz,
      defaults: [{ ref: stampedRef, onUpdate: instantNow }],
    });
  });

  it('reads the precision named as well as positional', () => {
    expect(columnAndDefaults(model('TimestampTemporal(precision: 3) @onCreate(now())'))).toEqual(
      columnAndDefaults(model('TimestampTemporal(3) @onCreate(now())')),
    );
  });
});
