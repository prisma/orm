import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { SqlColumnDefaultIR, type SqlColumnIR } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { postgresResolveDefault } from '../../src/core/default-normalizer';
import {
  buildSetDefaultColumn,
  renderColumnDdl,
} from '../../src/core/migrations/column-ddl-rendering';
import { buildPostgresPlanDiff } from '../../src/core/migrations/diff-database-schema';
import { renderDefaultLiteral } from '../../src/core/migrations/planner-ddl-builders';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { postgresTypeComponents, postgresTypeLookups } from '../postgres-type-lookups';

function expectedColumn(dataType: string, codecId: string, expression: string): SqlColumnIR {
  const contract: Contract<SqlStorage> = {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('authored-default'),
    storage: new SqlStorage({
      storageHash: coreHash('authored-default'),
      namespaces: {
        public: new PostgresSchema({
          id: 'public',
          entries: {
            table: {
              orders: new StorageTable({
                columns: {
                  value: {
                    dataType,
                    codecId,
                    nullable: false,
                    default: { kind: 'function', expression },
                  },
                },
                foreignKeys: [],
                uniques: [],
                indexes: [],
              }),
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
  const { expected } = buildPostgresPlanDiff({
    contract,
    actualSchema: new PostgresDatabaseSchemaNode({
      namespaces: {},
      roles: [],
      existingSchemas: ['public'],
      pgVersion: 'unknown',
    }),
    frameworkComponents: postgresTypeComponents,
  });
  const column = expected.namespaces['public']?.tables['orders']?.columns['value'];
  if (column === undefined) throw new Error('expected column derived');
  return column;
}

function defaultNodeOf(column: SqlColumnIR): SqlColumnDefaultIR {
  const [child] = column.children();
  if (child === undefined || !(child instanceof SqlColumnDefaultIR)) {
    throw new Error('expected a default node');
  }
  return child;
}

describe('a sql`...` default on Postgres renders as authored', () => {
  it.each([
    ["nextval('orders_seq'::regclass)", 'int4', 'pg/int4', 'pg/int4@1'],
    ['CURRENT_TIMESTAMP', 'timestamptz', 'pg/timestamptz', 'pg/timestamptz-temporal@1'],
    ["'{}'::jsonb", 'jsonb', 'pg/jsonb', 'pg/jsonb@1'],
  ])(
    'writes DEFAULT (%s) on a %s column in CREATE TABLE and SET DEFAULT',
    (expression, nativeType, dataType, codecId) => {
      const column = expectedColumn(dataType, codecId, expression);

      const ddl = renderColumnDdl('value', column, postgresTypeLookups);
      const setDefault = buildSetDefaultColumn('value', defaultNodeOf(column), postgresTypeLookups);

      expect({ type: ddl.type, default: ddl.default }).toEqual({
        type: nativeType,
        default: { kind: 'function', expression },
      });
      expect(setDefault?.default).toEqual(ddl.default);
    },
  );

  it('writes SERIAL for a column authored as autoincrement()', () => {
    const column = expectedColumn('pg/int4', 'pg/int4@1', 'autoincrement()');

    const ddl = renderColumnDdl('value', column, postgresTypeLookups);

    expect({ type: ddl.type, default: ddl.default }).toEqual({
      type: 'SERIAL',
      default: undefined,
    });
  });
});

describe("a literal-shaped sql`'{}'::jsonb` body on Postgres", () => {
  it("resolves to the literal introspection reads, which renders as '{}'::jsonb", () => {
    const resolved = postgresResolveDefault(
      { kind: 'function', expression: "'{}'::jsonb" },
      'jsonb',
    );
    expect(resolved).toEqual({ kind: 'literal', value: {} });
    if (resolved.kind !== 'literal') throw new Error('literal expected');
    expect(
      renderDefaultLiteral(resolved.value, { baseTypeName: 'jsonb', dataType: 'pg/jsonb' }),
    ).toBe("'{}'::jsonb");
  });
});
