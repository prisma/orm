import { asNamespaceId } from '@internal/contract/types';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { index } from '@internal/sql-contract/factories';
import { toStorageTypeInstance } from '@internal/sql-contract/types';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { SqlForeignKeyIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { postgresDataTypes } from '../../src/core/data-types';
import { buildPostgresPlanDiff } from '../../src/core/migrations/diff-database-schema';
import {
  coalesceSubtreeIssues,
  mapNodeIssueToCall,
  planIssues as planNodeIssues,
} from '../../src/core/migrations/issue-planner';
import { AlterColumnTypeCall, RenameIndexCall } from '../../src/core/migrations/op-factory-call';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { postgresTypeComponents, postgresTypeLookups } from '../postgres-type-lookups';
import {
  emptyRoot,
  makeContract,
  planFor,
  rootOf,
  type TableSpec,
} from './node-issue-planner-fixtures';

/**
 * Direct coverage for the node-based Postgres planner (the one-differ path):
 * `buildPostgresPlanDiff` (tree diff) → `mapNodeIssueToCall` / `planIssues`
 * (node → op), now wired into `PostgresMigrationPlanner`. This suite passes
 * `strategies: []` deliberately, so it drives the default per-issue mapper
 * directly — the real `postgresPlannerStrategies` list (NOT-NULL backfill,
 * type-change, nullable-tightening, check constraints, codec storage types,
 * shared-temp-default add-column) is covered by the cross-package planner /
 * control-policy suites and `rls-planner.test.ts`.
 *
 * The `ALTER COLUMN TYPE` postcheck compares `format_type` text; TML-3387
 * replaces it with a type identity comparison.
 */

const userTable: TableSpec = {
  columns: {
    id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
    email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
  },
  primaryKey: { columns: ['id'] },
  foreignKeys: [],
  uniques: [],
  indexes: [],
};

const userField = (field: string) => ({
  namespaceId: asNamespaceId('public'),
  model: 'User',
  field,
});

describe('buildPostgresPlanDiff + planNodeIssues (one-differ path)', () => {
  it('a fresh table becomes CreateTable (+ PK inline)', () => {
    const contract = makeContract({ user: userTable });
    const calls = planFor(contract, emptyRoot());
    expect(calls.map((c) => c.factoryName)).toEqual(['createTable']);
    expect(calls[0]).toMatchObject({
      factoryName: 'createTable',
      tableName: 'user',
      schemaName: 'public',
    });
  });

  it('a fresh table with an index / FK / unique emits the child constraint calls', () => {
    const contract = makeContract({
      user: userTable,
      post: {
        columns: {
          id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
          userId: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
          slug: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          {
            source: { namespaceId: 'public', tableName: 'post', columns: ['userId'] },
            target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
          },
        ],
        uniques: [{ columns: ['slug'] }],
        indexes: [index('post_slug_idx', ['slug'])],
      },
    });
    const factoryNames = planFor(contract, emptyRoot()).map((c) => c.factoryName);
    // Emission buckets: table → unique → index → foreignKey.
    expect(factoryNames).toContain('createTable');
    expect(factoryNames).toContain('addUnique');
    expect(factoryNames).toContain('createIndex');
    expect(factoryNames).toContain('addForeignKey');
    expect(factoryNames.indexOf('addUnique')).toBeLessThan(factoryNames.indexOf('createIndex'));
    expect(factoryNames.indexOf('createIndex')).toBeLessThan(factoryNames.indexOf('addForeignKey'));
  });

  it('a missing column on an existing table becomes AddColumn', () => {
    const contract = makeContract({ user: userTable });
    const actual = rootOf({
      user: new PostgresTableSchemaNode({
        name: 'user',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const calls = planFor(contract, actual);
    expect(calls.map((c) => c.factoryName)).toEqual(['addColumn']);
    expect(calls[0]).toMatchObject({
      factoryName: 'addColumn',
      tableName: 'user',
      column: { name: 'email' },
    });
  });

  it('an extra live column becomes DropColumn (strict)', () => {
    const contract = makeContract({ user: userTable });
    const actual = rootOf({
      user: new PostgresTableSchemaNode({
        name: 'user',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
          email: { name: 'email', nativeType: 'text', nullable: false, resolvedNativeType: 'text' },
          legacy: {
            name: 'legacy',
            nativeType: 'text',
            nullable: true,
            resolvedNativeType: 'text',
          },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const calls = planFor(contract, actual);
    expect(calls.map((c) => c.factoryName)).toEqual(['dropColumn']);
    expect(calls[0]).toMatchObject({ factoryName: 'dropColumn', columnName: 'legacy' });
  });

  it('a type + nullability drift on one column emits AlterColumnType then the nullability op', () => {
    const contract = makeContract({
      user: {
        columns: {
          id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
          age: { dataType: 'pg/int8', codecId: 'pg/int8@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    });
    const actual = rootOf({
      user: new PostgresTableSchemaNode({
        name: 'user',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
          age: { name: 'age', nativeType: 'int4', nullable: true, resolvedNativeType: 'int4' },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const calls = planFor(contract, actual);
    expect(calls.map((c) => c.factoryName)).toEqual(['alterColumnType', 'setNotNull']);
  });

  describe('a type change of an introspected column, with no origin contract', () => {
    function alterClass(
      live: { readonly nativeType: string; readonly many?: boolean },
      contractColumn: TableSpec['columns'][string],
    ) {
      const contract = makeContract({
        user: {
          columns: {
            id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
            age: contractColumn,
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      });
      const actual = rootOf({
        user: new PostgresTableSchemaNode({
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
            age: {
              name: 'age',
              nativeType: live.nativeType,
              nullable: false,
              resolvedNativeType: live.nativeType,
              ...(live.many === undefined ? {} : { many: live.many }),
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          policies: [],
          rlsEnabled: false,
        }),
      });
      const call = planFor(contract, actual).find((c) => c instanceof AlterColumnTypeCall);
      return call?.operationClass;
    }

    it('is widening for a safe widening read from the written type name', () => {
      expect([
        alterClass(
          { nativeType: 'int4' },
          { dataType: 'pg/int8', codecId: 'pg/int8@1', nullable: false },
        ),
        alterClass(
          { nativeType: 'int2' },
          { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
        ),
        alterClass(
          { nativeType: 'float4' },
          { dataType: 'pg/float8', codecId: 'pg/float8@1', nullable: false },
        ),
      ]).toEqual(['widening', 'widening', 'widening']);
    });

    it('is widening for a parameter that grows on one data type, and varchar to text', () => {
      const varchar = (length?: number) => ({
        dataType: 'pg/varchar',
        codecId: 'pg/varchar@1',
        nullable: false,
        ...(length === undefined ? {} : { typeParams: { length } }),
      });
      const numeric = (precision?: number, scale?: number) => ({
        dataType: 'pg/numeric',
        codecId: 'pg/numeric@1',
        nullable: false,
        ...(precision === undefined
          ? {}
          : { typeParams: { precision, ...(scale === undefined ? {} : { scale }) } }),
      });
      expect([
        alterClass({ nativeType: 'character varying(10)' }, varchar(20)),
        alterClass({ nativeType: 'character varying(10)' }, varchar()),
        alterClass(
          { nativeType: 'character varying(10)' },
          { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
        ),
        alterClass({ nativeType: 'numeric(10,2)' }, numeric(12, 2)),
        alterClass({ nativeType: 'numeric(10,2)' }, numeric(12, 4)),
        alterClass({ nativeType: 'numeric(10,2)' }, numeric()),
      ]).toEqual(Array(6).fill('widening'));
      expect([
        alterClass({ nativeType: 'character varying(20)' }, varchar(10)),
        alterClass({ nativeType: 'text' }, varchar(10)),
        alterClass({ nativeType: 'numeric(10,2)' }, numeric(10, 3)),
        alterClass({ nativeType: 'numeric' }, numeric(10, 2)),
        alterClass(
          { nativeType: 'character(5)' },
          {
            dataType: 'pg/char',
            codecId: 'pg/char@1',
            nullable: false,
            typeParams: { length: 10 },
          },
        ),
      ]).toEqual(Array(5).fill('destructive'));
    });

    it('is destructive for a type change that can change values, or one between lists', () => {
      expect([
        alterClass(
          { nativeType: 'int8' },
          { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
        ),
        alterClass(
          { nativeType: 'text' },
          { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
        ),
        alterClass(
          { nativeType: 'int4', many: true },
          {
            dataType: 'pg/int8',
            codecId: 'pg/int8@1',
            nullable: false,
            many: { elementNullable: false },
          },
        ),
        alterClass(
          { nativeType: 'float4' },
          { dataType: 'pg/int8', codecId: 'pg/int8@1', nullable: false },
        ),
        alterClass(
          { nativeType: 'numeric(10,2)' },
          { dataType: 'pg/int8', codecId: 'pg/int8@1', nullable: false },
        ),
        alterClass(
          { nativeType: 'int8' },
          { dataType: 'pg/float8', codecId: 'pg/float8@1', nullable: false },
        ),
      ]).toEqual(Array(6).fill('destructive'));
    });
  });

  it('checks a type change of a column that references a storage type against the catalog text of the referenced type', () => {
    const contract = makeContract(
      {
        user: {
          columns: {
            id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
            visits: {
              dataType: 'pg/int8',
              codecId: 'pg/int8@1',
              nullable: false,
              typeRef: 'Count',
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      { Count: toStorageTypeInstance({ codecId: 'pg/int8@1', dataType: 'pg/int8' }) },
    );
    const actual = rootOf({
      user: new PostgresTableSchemaNode({
        name: 'user',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
          visits: {
            name: 'visits',
            nativeType: 'int4',
            nullable: false,
            resolvedNativeType: 'int4',
          },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const [call] = planFor(contract, actual);
    expect(call).toBeInstanceOf(AlterColumnTypeCall);
    expect(
      call instanceof AlterColumnTypeCall && { type: call.type, checkType: call.checkType },
    ).toEqual({ type: 'int8', checkType: 'bigint' });
  });

  it.each([
    { from: 'tsvector', to: 'circle', checkType: 'circle' },
    { from: 'tsvector', to: 'character varying(10)', checkType: 'character varying(10)' },
    { from: 'integer', to: 'int4', checkType: 'int4' },
  ])(
    'checks a type change to the raw type $to against that text, as its data type writes it',
    ({ from, to, checkType }) => {
      const contract = makeContract({
        user: {
          columns: {
            id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
            area: {
              dataType: 'sql/raw',
              codecId: 'sql/raw@1',
              typeParams: { sql: to },
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      });
      const actual = rootOf({
        user: new PostgresTableSchemaNode({
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
            area: {
              name: 'area',
              nativeType: from,
              nullable: false,
              resolvedNativeType: from,
              reportedType: { text: from, kind: undefined, schema: 'pg_catalog', name: from },
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          policies: [],
          rlsEnabled: false,
        }),
      });
      const call = planFor(contract, actual).find((c) => c instanceof AlterColumnTypeCall);
      expect(
        call instanceof AlterColumnTypeCall && {
          type: call.type,
          raw: call.raw,
          checkType: call.checkType,
        },
      ).toEqual({ type: to, raw: true, checkType });
    },
  );

  it.each([
    { typeName: 'UserRole', typeRef: 'UserRole', formatTypeExpected: '"UserRole"' },
    { typeName: 'UserRole', typeRef: undefined, formatTypeExpected: '"UserRole"' },
    { typeName: 'user_role', typeRef: 'user_role', formatTypeExpected: 'user_role' },
    { typeName: 'user_role', typeRef: undefined, formatTypeExpected: 'user_role' },
    { typeName: 'select', typeRef: undefined, formatTypeExpected: '"select"' },
    { typeName: 'position', typeRef: undefined, formatTypeExpected: '"position"' },
  ])(
    'checks a type change to enum $typeName (typeRef $typeRef) against $formatTypeExpected',
    ({ typeName, typeRef, formatTypeExpected }) => {
      const enumType = { dataType: 'pg/enum', codecId: 'pg/enum@1', typeParams: { typeName } };
      const contract = makeContract(
        {
          user: {
            columns: {
              id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
              role: { ...enumType, nullable: false, ...ifDefined('typeRef', typeRef) },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          },
        },
        typeRef === undefined ? undefined : { [typeRef]: toStorageTypeInstance(enumType) },
      );
      const actual = rootOf({
        user: new PostgresTableSchemaNode({
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
            role: { name: 'role', nativeType: 'text', nullable: false, resolvedNativeType: 'text' },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          policies: [],
          rlsEnabled: false,
        }),
      });
      const call = planFor(contract, actual).find((c) => c instanceof AlterColumnTypeCall);
      expect(call instanceof AlterColumnTypeCall && call.checkType).toBe(formatTypeExpected);
    },
  );

  it('refuses to plan a conversion for a live column that carries no codec', () => {
    const contract = makeContract({
      user: {
        columns: {
          id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
          age: { dataType: 'pg/int8', codecId: 'pg/int8@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    });
    const actual = rootOf({
      user: new PostgresTableSchemaNode({
        name: 'user',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
          age: { name: 'age', nativeType: 'int4', nullable: false, resolvedNativeType: 'int4' },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const { issues } = buildPostgresPlanDiff({
      contract,
      actualSchema: actual,
      frameworkComponents: postgresTypeComponents,
    });

    expect(() =>
      planNodeIssues({
        issues: coalesceSubtreeIssues(issues),
        toContract: contract,
        fromContract: contract,
        schemaName: 'public',
        codecHooks: new Map(),
        types: postgresTypeLookups,
        storageTypes: {},
        frameworkComponents: postgresTypeComponents,
        statementColumns: {
          convert: [
            {
              namespaceId: 'public',
              table: 'user',
              column: 'age',
              field: userField('age'),
              text: 'User.age',
            },
          ],
          backfill: [],
        },
      }),
    ).toThrow(InternalError);
  });

  it('an extra live table becomes DropTable (strict)', () => {
    const contract = makeContract({ user: userTable });
    const actual = rootOf({
      user: new PostgresTableSchemaNode({
        name: 'user',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
          email: { name: 'email', nativeType: 'text', nullable: false, resolvedNativeType: 'text' },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
      orphan: new PostgresTableSchemaNode({
        name: 'orphan',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const calls = planFor(contract, actual);
    expect(calls.map((c) => c.factoryName)).toEqual(['dropTable']);
    expect(calls[0]).toMatchObject({ factoryName: 'dropTable', tableName: 'orphan' });
  });
});

describe('mapNodeIssueToCall — synthesized namespace issue', () => {
  it('a postgres-namespace not-found becomes CreateSchema', () => {
    const namespace = new PostgresNamespaceSchemaNode({
      schemaName: 'auth',
      tables: {},
    });
    const issue: SchemaDiffIssue = {
      path: ['database', 'auth'],
      expected: namespace,
    };
    const ctx = {
      toContract: makeContract({ user: userTable }),
      fromContract: null,
      schemaName: 'public',
      codecHooks: new Map(),
      types: postgresTypeLookups,
      storageTypes: {},
      schema: undefined as never,
      policy: { allowedOperationClasses: ['additive'] as const },
      frameworkComponents: postgresTypeComponents,
      statementColumns: { convert: [], backfill: [] },
      dataTypes: postgresDataTypes,
    };
    const result = mapNodeIssueToCall(issue, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.map((c) => c.factoryName)).toEqual(['createSchema']);
    expect(result.value[0]).toMatchObject({ factoryName: 'createSchema', schemaName: 'auth' });
  });
});

describe('planNodeIssues — dependency-graph ordering', () => {
  const fkToUser = new SqlForeignKeyIR({
    columns: ['userId'],
    referencedTable: 'user',
    referencedColumns: ['id'],
    referencedSchema: 'public',
    resolvedReferencedNamespace: 'public',
    // Mirrors what the introspection adapter stamps (`postgresTableDependsOn`):
    // the FK depends on its referenced table's node.
    dependsOn: [
      [
        { nodeKind: 'postgres-database', id: 'database' },
        { nodeKind: 'postgres-namespace', id: 'public' },
        { nodeKind: 'postgres-table', id: 'user' },
      ],
    ],
  });

  function postWithFk(): PostgresTableSchemaNode {
    return new PostgresTableSchemaNode({
      name: 'post',
      columns: {
        id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
        userId: { name: 'userId', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [fkToUser],
      uniques: [],
      indexes: [],
      policies: [],
      rlsEnabled: false,
    });
  }

  function userTableNode(): PostgresTableSchemaNode {
    return new PostgresTableSchemaNode({
      name: 'user',
      columns: {
        id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
      policies: [],
      rlsEnabled: false,
    });
  }

  // Contract keeps `post` (its FK to `user` removed) and drops `user`. On the
  // way down the dependent op (DROP CONSTRAINT on post's FK) must precede the
  // dependency op (DROP TABLE user) — the graph reverses the edge for drops.
  it('drops a foreign key before the referenced table it depends on', () => {
    const contract = makeContract({
      post: {
        columns: {
          id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
          userId: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    });
    const actual = rootOf({ post: postWithFk(), user: userTableNode() });
    const factoryNames = planFor(contract, actual).map((c) => c.factoryName);
    expect(factoryNames).toContain('dropConstraint');
    expect(factoryNames).toContain('dropTable');
    expect(factoryNames.indexOf('dropConstraint')).toBeLessThan(factoryNames.indexOf('dropTable'));
  });

  const legacyColumnChain = [
    { nodeKind: 'postgres-database', id: 'database' },
    { nodeKind: 'postgres-namespace', id: 'public' },
    { nodeKind: 'postgres-table', id: 'account' },
    { nodeKind: 'sql-column', id: 'column:legacy' },
  ];

  // A surviving table whose `legacy` column — plus the FK, unique, and index
  // built on it — are all dropped. Postgres auto-drops the constraint/index
  // when the column goes, so each object's `DROP` (no `IF EXISTS`) must run
  // before the `DROP COLUMN`; the own-column edges reverse on the way down to
  // enforce that. Without the edges the topo tiebreak sorts `column:legacy`
  // first and the plan errors at apply time.
  it('drops a column-backed FK, unique, and index before the column itself', () => {
    const contract = makeContract({
      account: {
        columns: {
          id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    });
    const actual = rootOf({
      account: new PostgresTableSchemaNode({
        name: 'account',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
          email: { name: 'email', nativeType: 'text', nullable: false, resolvedNativeType: 'text' },
          legacy: {
            name: 'legacy',
            nativeType: 'uuid',
            nullable: true,
            resolvedNativeType: 'uuid',
          },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          {
            columns: ['legacy'],
            referencedTable: 'org',
            referencedColumns: ['id'],
            referencedSchema: 'public',
            name: 'account_legacy_fkey',
            dependsOn: [legacyColumnChain],
          },
        ],
        uniques: [
          { columns: ['legacy'], name: 'account_legacy_key', dependsOn: [legacyColumnChain] },
        ],
        indexes: [
          {
            naming: parseNaming('account_legacy_idx', undefined),
            columns: ['legacy'],
            where: undefined,
            unique: false,
            partial: false,
            type: undefined,
            options: undefined,
            annotations: undefined,
            dependsOn: [legacyColumnChain],
          },
        ],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const factoryNames = planFor(contract, actual).map((c) => c.factoryName);
    const dropColumnAt = factoryNames.indexOf('dropColumn');
    expect(dropColumnAt).toBeGreaterThanOrEqual(0);
    // The FK and the unique both lower to `dropConstraint`.
    expect(factoryNames.filter((n) => n === 'dropConstraint')).toHaveLength(2);
    expect(factoryNames.lastIndexOf('dropConstraint')).toBeLessThan(dropColumnAt);
    expect(factoryNames.indexOf('dropIndex')).toBeGreaterThanOrEqual(0);
    expect(factoryNames.indexOf('dropIndex')).toBeLessThan(dropColumnAt);
  });
});

describe('mapNodeIssueToCall — table rlsEnabled drift', () => {
  const ctx = {
    toContract: makeContract({ user: userTable }),
    fromContract: null,
    schemaName: 'public',
    codecHooks: new Map(),
    types: postgresTypeLookups,
    storageTypes: {},
    schema: undefined as never,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const },
    frameworkComponents: postgresTypeComponents,
    statementColumns: { convert: [], backfill: [] },
    dataTypes: postgresDataTypes,
  };

  function tableNode(rlsEnabled: boolean): PostgresTableSchemaNode {
    return new PostgresTableSchemaNode({
      name: 'user',
      columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
      policies: [],
      rlsEnabled,
    });
  }

  function notEqualIssue(
    expected: PostgresTableSchemaNode,
    actual: PostgresTableSchemaNode,
  ): SchemaDiffIssue {
    return {
      path: ['database', 'public', 'user'],
      expected,
      actual,
    };
  }

  it('maps expected-on / actual-off to enableRowLevelSecurity', () => {
    const result = mapNodeIssueToCall(notEqualIssue(tableNode(true), tableNode(false)), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.map((c) => c.factoryName)).toEqual(['enableRowLevelSecurity']);
  });

  it('maps expected-off / actual-on to disableRowLevelSecurity', () => {
    const result = mapNodeIssueToCall(notEqualIssue(tableNode(false), tableNode(true)), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.map((c) => c.factoryName)).toEqual(['disableRowLevelSecurity']);
  });

  it('fails loud on a table not-equal where rlsEnabled matches on both sides (a second attribute drifted)', () => {
    // The differ pairs table nodes by name and `isEqualTo` compares name +
    // rlsEnabled, so this state cannot arise today — the guard makes the
    // "rlsEnabled is the only attribute" coupling explicit: a not-equal with
    // no rlsEnabled delta means an unhandled second attribute drifted, and we
    // fail rather than silently emit a bogus enable/disable.
    const result = mapNodeIssueToCall(notEqualIssue(tableNode(true), tableNode(true)), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected notOk');
    expect(result.failure.summary).toMatch(/unhandled table-attribute drift/i);
  });
});

describe('coalesceSubtreeIssues', () => {
  it('drops issues whose path is a strict descendant of a not-found ancestor', () => {
    const contract = makeContract({ user: userTable });
    const { issues } = buildPostgresPlanDiff({
      contract,
      actualSchema: emptyRoot(),
      frameworkComponents: postgresTypeComponents,
    });
    // The total differ emits the table not-found plus every column/PK under it.
    expect(issues.length).toBeGreaterThan(1);
    const coalesced = coalesceSubtreeIssues(issues);
    // Only the table-level not-found survives.
    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]?.path).toEqual(['database', 'public', 'user']);
  });
});

describe('operation-class gating of a RenameIndexCall', () => {
  it('a policy-disallowed rename surfaces an indexIncompatible conflict at the index location, labeled with the rename', () => {
    const contract = makeContract({ user: userTable });
    const { issues } = buildPostgresPlanDiff({
      contract,
      actualSchema: emptyRoot(),
      frameworkComponents: postgresTypeComponents,
    });
    const coalesced = coalesceSubtreeIssues(issues);
    const renameCall = new RenameIndexCall(
      'public',
      'user',
      'old_email_idx',
      'user_email_idx_46df9cad',
    );
    const renameEmittingStrategy = (strategyIssues: readonly SchemaDiffIssue[]) =>
      ({ kind: 'match', issues: strategyIssues, calls: [renameCall] }) as const;

    const result = planNodeIssues({
      issues: coalesced,
      toContract: contract,
      fromContract: null,
      schemaName: 'public',
      codecHooks: new Map(),
      types: postgresTypeLookups,
      storageTypes: contract.storage.types ?? {},
      policy: { allowedOperationClasses: ['additive'] },
      strategies: [renameEmittingStrategy],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected conflicts');
    const conflicts = result.failure;
    const renameConflict = conflicts.find((c) => c.summary.includes('Rename index'));
    expect(renameConflict).toMatchObject({
      kind: 'indexIncompatible',
      summary:
        'Operation "Rename index "old_email_idx" to "user_email_idx_46df9cad" on "user"" requires class "widening", but policy allows only: additive',
      refusedOperationClass: 'widening',
      location: {
        entityKind: 'table',
        entityName: 'user',
        index: 'user_email_idx_46df9cad',
      },
    });
  });
});

describe('statement columns', () => {
  it('reach every strategy through its context', () => {
    const contract = makeContract({ user: userTable });
    const statementColumns = {
      convert: [
        {
          namespaceId: 'public',
          table: 'user',
          column: 'email',
          field: userField('email'),
          text: 'User.email',
        },
      ],
      backfill: [
        {
          namespaceId: 'public',
          table: 'user',
          column: 'id',
          field: userField('id'),
          text: 'User.id',
        },
      ],
    };
    const seen: unknown[] = [];
    planNodeIssues({
      issues: [],
      toContract: contract,
      fromContract: null,
      schemaName: 'public',
      codecHooks: new Map(),
      types: postgresTypeLookups,
      storageTypes: {},
      statementColumns,
      strategies: [
        (issues, context) => {
          seen.push(context.statementColumns);
          return { kind: 'match', issues, calls: [] };
        },
      ],
    });

    expect(seen).toEqual([statementColumns]);
  });
});
