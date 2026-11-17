/**
 * The Postgres planner decides whether a column's type changed by its data type and normal-form parameters, never by the text either side writes the type with.
 */
import { asNamespaceId } from '@internal/contract/types';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { SqlColumnIR, type SqlColumnIRInput } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { postgresDataTypes } from '../../src/core/data-types';
import { buildPostgresPlanDiff } from '../../src/core/migrations/diff-database-schema';
import { AlterColumnTypeCall } from '../../src/core/migrations/op-factory-call';
import {
  nullableTighteningCallStrategy,
  type StrategyContext,
  typeChangeCallStrategy,
} from '../../src/core/migrations/planner-strategies';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import {
  introspectedColumn,
  postgresTypeComponents,
  postgresTypeLookups,
} from '../postgres-type-lookups';
import {
  emptyRoot,
  makeContract,
  planFor,
  planTrees,
  rootOf,
  type TableSpec,
} from './node-issue-planner-fixtures';

type ContractColumn = TableSpec['columns'][string];

const id: ContractColumn = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };

function contractWith(column: ContractColumn) {
  return makeContract({
    user: {
      columns: { id, value: column },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
    },
  });
}

function liveWith(column: Omit<SqlColumnIRInput, 'name'>) {
  return rootOf({
    user: new PostgresTableSchemaNode({
      name: 'user',
      columns: {
        id: introspectedColumn({ name: 'id', typeText: 'integer', nullable: false }),
        value: introspectedColumn({ name: 'value', ...column }),
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
      policies: [],
      rlsEnabled: false,
    }),
  });
}

function typeChangesPlanned(column: ContractColumn, live: Omit<SqlColumnIRInput, 'name'>) {
  return planFor(contractWith(column), liveWith(live)).filter(
    (call) => call instanceof AlterColumnTypeCall,
  ).length;
}

describe('the planner compares a live column with the contract by data type', () => {
  it('plans only the nullability change for the same type written another way', () => {
    expect([
      typeChangesPlanned(
        {
          dataType: 'pg/varchar',
          codecId: 'pg/varchar@1',
          nullable: false,
          typeParams: { length: 20 },
        },
        { typeText: 'varchar(20)', nullable: true },
      ),
      typeChangesPlanned(
        {
          dataType: 'pg/timestamptz',
          codecId: 'pg/timestamptz-string@1',
          nullable: false,
          typeParams: { precision: 3 },
        },
        {
          typeText: 'timestamp(3) with time zone',
          nullable: true,
        },
      ),
      typeChangesPlanned(
        {
          dataType: 'pg/numeric',
          codecId: 'pg/numeric@1',
          nullable: false,
          typeParams: { precision: 10 },
        },
        { typeText: 'numeric(10,0)', nullable: true },
      ),
      typeChangesPlanned(
        { dataType: 'pg/char', codecId: 'pg/char@1', nullable: false },
        { typeText: 'character(1)', nullable: true },
      ),
      typeChangesPlanned(
        {
          dataType: 'pg/int4',
          codecId: 'pg/int4@1',
          nullable: false,
          many: { elementNullable: false },
        },
        { typeText: 'int', nullable: true, many: true },
      ),
    ]).toEqual([0, 0, 0, 0, 0]);
  });

  it('plans no type change between an omitted precision and precision 6 on a date or time column', () => {
    const timestamptz = (typeParams?: { precision: number }) => ({
      dataType: 'pg/timestamptz',
      codecId: 'pg/timestamptz-date@1',
      nullable: true,
      ...(typeParams === undefined ? {} : { typeParams }),
    });
    expect([
      typeChangesPlanned(timestamptz(), {
        typeText: 'timestamp(6) with time zone',
        nullable: true,
      }),
      typeChangesPlanned(timestamptz({ precision: 6 }), {
        typeText: 'timestamp with time zone',
        nullable: true,
      }),
      typeChangesPlanned(timestamptz({ precision: 3 }), {
        typeText: 'timestamp with time zone',
        nullable: true,
      }),
    ]).toEqual([0, 0, 1]);
  });

  it('plans a type change for a live column no data type claims, whatever its text', () => {
    expect(
      typeChangesPlanned(
        { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
        {
          typeText: 'text',
          nullable: false,
          reportedType: { text: 'citext', kind: undefined, schema: 'public', name: 'citext' },
        },
      ),
    ).toBe(1);
  });

  it('plans a type change between a list and a single value of one data type', () => {
    expect(
      typeChangesPlanned(
        {
          dataType: 'pg/int4',
          codecId: 'pg/int4@1',
          nullable: false,
          many: { elementNullable: false },
        },
        { typeText: 'integer', nullable: false },
      ),
    ).toBe(1);
  });

  it('classes a widening by the live column data type, without the type text', () => {
    const contract = contractWith({ dataType: 'pg/int8', codecId: 'pg/int8@1', nullable: false });
    const live = liveWith({ typeText: 'integer', nullable: false });
    const call = planFor(contract, live).find((c) => c instanceof AlterColumnTypeCall);
    expect(call?.operationClass).toBe('widening');
  });
});

describe('the convert and backfill strategies compare by data type', () => {
  const contract = contractWith({
    dataType: 'pg/varchar',
    codecId: 'pg/varchar@1',
    nullable: false,
    typeParams: { length: 20 },
  });
  const expected = expectedValueColumn();
  const actual = new SqlColumnIR(
    introspectedColumn({
      name: 'value',
      typeText: 'varchar(20)',
      nullable: true,
    }),
  );
  const issue: SchemaDiffIssue = {
    path: ['database', 'public', 'user', 'column:value'],
    expected,
    actual,
  };
  const statement = {
    namespaceId: 'public',
    table: 'user',
    column: 'value',
    field: { namespaceId: asNamespaceId('public'), model: 'User', field: 'value' },
    text: 'User.value',
  };
  const ctx = (statementColumns: StrategyContext['statementColumns']): StrategyContext => ({
    toContract: contract,
    fromContract: contract,
    schemaName: 'public',
    codecHooks: new Map(),
    types: postgresTypeLookups,
    schema: undefined as never,
    ...planTrees(),
    allIssues: [],
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    frameworkComponents: postgresTypeComponents,
    statementColumns,
    dataTypes: postgresDataTypes,
  });

  it('leaves a column whose type did not change to the backfill, not the conversion', () => {
    expect({
      convert: typeChangeCallStrategy([issue], ctx({ convert: [statement], backfill: [] })).kind,
      backfill: nullableTighteningCallStrategy([issue], ctx({ convert: [], backfill: [statement] }))
        .kind,
    }).toEqual({ convert: 'no_match', backfill: 'match' });
  });

  function expectedValueColumn(): SqlColumnIR {
    const { expected } = buildPostgresPlanDiff({
      contract,
      actualSchema: emptyRoot(),
      frameworkComponents: postgresTypeComponents,
    });
    PostgresDatabaseSchemaNode.assert(expected);
    const column = expected.namespaces['public']?.tables['user']?.columns['value'];
    if (column === undefined) throw new Error('the contract has the column');
    return column;
  }
});
