import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { CodecControlHooks, SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { APP_SPACE_ID, type OpFactoryCall } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumn, type StorageTable } from '@internal/sql-contract/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { expectNarrowedType } from '@repo/test-utils/typed-expectations';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

const emptySchema = new PostgresDatabaseSchemaNode({
  namespaces: {
    public: new PostgresNamespaceSchemaNode({
      schemaName: 'public',
      tables: {},
    }),
  },
  pgVersion: '',
  roles: [],
  existingSchemas: [],
});
const testAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

const PG_TEXT_CODEC = 'pg/text@1';
const HOOKED_CODEC = 'cs/string@1';

function col(overrides: Partial<StorageColumn> & { codecId: string }): StorageColumn {
  return { nativeType: 'text', nullable: false, ...overrides };
}

function table(columns: Record<string, StorageColumn>): StorageTable {
  return { columns, uniques: [], indexes: [], foreignKeys: [] };
}

function contract(tables: Record<string, StorageTable>, hash = 'c'): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: tables },
        }),
      },
    }),
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function wrapOp(op: SqlMigrationPlanOperation<unknown>): OpFactoryCall {
  return {
    factoryName: op.id,
    operationClass: op.operationClass,
    label: op.label,
    renderTypeScript: () => `${op.id}()`,
    importRequirements: () => [],
    toOp: () => op,
  };
}

function makeFrameworkComponents(
  hooks: CodecControlHooks,
): ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>> {
  return [
    {
      kind: 'adapter',
      id: 'test-codec',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.0-test',
      types: {
        codecTypes: {
          controlPlaneHooks: {
            [HOOKED_CODEC]: hooks,
          },
        },
      },
    } as TargetBoundComponentDescriptor<'sql', string>,
  ];
}

describe('PostgresMigrationPlanner - codec onFieldEvent wiring', () => {
  it('inlines ops emitted by onFieldEvent after structural DDL', async () => {
    const planner = createPostgresMigrationPlanner(testAdapter);

    const hooks: CodecControlHooks = {
      onFieldEvent: (event, ctx) => [
        wrapOp({
          id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
          label: `${event} hook on ${ctx.tableName}.${ctx.fieldName}`,
          operationClass: 'additive',
          invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
          target: { id: 'postgres' },
          precheck: [],
          execute: [{ description: 'codec side-effect', sql: '-- codec side-effect' }],
          postcheck: [],
        }),
      ],
    };

    const frameworkComponents = makeFrameworkComponents(hooks);

    const result = planner.plan({
      contract: contract(
        {
          User: table({
            id: col({ codecId: PG_TEXT_CODEC }),
            email: col({ codecId: HOOKED_CODEC }),
          }),
        },
        'to',
      ),
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expectNarrowedType(result.kind === 'success');
    const ops = await Promise.all(result.plan.operations);
    const ids = ops.map((op) => op.id);
    expect(ids[ids.length - 1]).toBe('codec.added.User.email');
    expect(ids).toContain('table.User');
  });

  it('does not fire when no codec has an onFieldEvent hook', async () => {
    const planner = createPostgresMigrationPlanner(testAdapter);

    const frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>> = [];

    const result = planner.plan({
      contract: contract(
        {
          User: table({ id: col({ codecId: PG_TEXT_CODEC }) }),
        },
        'to',
      ),
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expectNarrowedType(result.kind === 'success');
    const ops = await Promise.all(result.plan.operations);
    expect(ops.every((op) => !op.id.startsWith('codec.'))).toBe(true);
  });

  it('produces byte-identical operations across re-emits (deterministic)', async () => {
    const planner = createPostgresMigrationPlanner(testAdapter);

    const hooks: CodecControlHooks = {
      onFieldEvent: (event, ctx) => [
        wrapOp({
          id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
          label: 'hook',
          operationClass: 'additive',
          invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
          target: { id: 'postgres' },
          precheck: [],
          execute: [{ description: 'side', sql: '-- side' }],
          postcheck: [],
        }),
      ],
    };
    const frameworkComponents = makeFrameworkComponents(hooks);

    const c = contract(
      {
        User: table({
          id: col({ codecId: PG_TEXT_CODEC }),
          email: col({ codecId: HOOKED_CODEC }),
          name: col({ codecId: HOOKED_CODEC }),
        }),
      },
      'to',
    );

    const a = planner.plan({
      contract: c,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    const b = planner.plan({
      contract: c,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expectNarrowedType(a.kind === 'success');
    expectNarrowedType(b.kind === 'success');
    const aOps = await Promise.all(a.plan.operations);
    const bOps = await Promise.all(b.plan.operations);
    expect(JSON.stringify(aOps)).toBe(JSON.stringify(bOps));
  });
});
