import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { CodecControlHooks, SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { APP_SPACE_ID, type OpFactoryCall } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumn, type StorageTable } from '@internal/sql-contract/types';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { createSqliteMigrationPlanner } from '@internal/target-sqlite/planner';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../../src/core/control-adapter';

const HOOKED_CODEC = 'cs/string@1';

function col(overrides: Partial<StorageColumn> & { codecId: string }): StorageColumn {
  return { many: false, nativeType: 'text', nullable: false, ...overrides };
}

function table(columns: Record<string, StorageColumn>): StorageTable {
  return { columns, uniques: [], indexes: [], foreignKeys: [] };
}

function contract(tables: Record<string, StorageTable>, hash = 'c'): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
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
      targetId: 'sqlite',
      version: '0.0.0-test',
      types: { codecTypes: { controlPlaneHooks: { [HOOKED_CODEC]: hooks } } },
    } as TargetBoundComponentDescriptor<'sql', string>,
  ];
}

describe('SqliteMigrationPlanner - codec onFieldEvent wiring', () => {
  const planner = createSqliteMigrationPlanner(
    new SqliteControlAdapter(createSqliteBuiltinCodecLookup()),
  );

  it('inlines ops emitted by onFieldEvent after structural DDL', async () => {
    const hooks: CodecControlHooks = {
      onFieldEvent: (event, ctx) => [
        wrapOp({
          id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
          label: `${event} hook on ${ctx.tableName}.${ctx.fieldName}`,
          operationClass: 'additive',
          invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
          target: { id: 'sqlite' },
          precheck: [],
          execute: [{ description: 'side', sql: '-- side' }],
          postcheck: [],
        }),
      ],
    };

    const result = planner.plan({
      contract: contract(
        {
          User: table({
            id: col({ codecId: 'sqlite/text@1' }),
            email: col({ codecId: HOOKED_CODEC }),
          }),
        },
        'to',
      ),
      schema: { tables: {} },
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: makeFrameworkComponents(hooks),
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const ids = ops.map((op) => op.id);
    expect(ids[ids.length - 1]).toBe('codec.added.User.email');
    expect(ids).toContain('table.User');
  });

  it('fires on field drop in app-space (verifies M2 R1 wiring across event kinds)', async () => {
    const events: string[] = [];
    const hooks: CodecControlHooks = {
      onFieldEvent: (event, ctx) => {
        events.push(`${event}:${ctx.tableName}.${ctx.fieldName}`);
        return [
          wrapOp({
            id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
            label: 'hook',
            operationClass: event === 'dropped' ? 'destructive' : 'additive',
            invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
            target: { id: 'sqlite' },
            precheck: [],
            execute: [{ description: 'side', sql: '-- side' }],
            postcheck: [],
          }),
        ];
      },
    };

    const fromContract = contract(
      {
        User: table({
          id: col({ codecId: 'sqlite/text@1' }),
          email: col({ codecId: HOOKED_CODEC }),
        }),
      },
      'from',
    );
    const toContract = contract(
      {
        User: table({ id: col({ codecId: 'sqlite/text@1' }) }),
      },
      'to',
    );

    const result = planner.plan({
      contract: toContract,
      schema: {
        tables: {
          User: table({
            id: col({ codecId: 'sqlite/text@1' }),
            email: col({ codecId: HOOKED_CODEC }),
          }),
        },
      },
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract,
      frameworkComponents: makeFrameworkComponents(hooks),
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(events).toContain('dropped:User.email');
    const ops = await Promise.all(result.plan.operations);
    const ids = ops.map((op) => op.id);
    expect(ids).toContain('codec.dropped.User.email');
  });

  it('does not fire when no codec has an onFieldEvent hook', async () => {
    const result = planner.plan({
      contract: contract(
        {
          User: table({ id: col({ codecId: 'sqlite/text@1' }) }),
        },
        'to',
      ),
      schema: { tables: {} },
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.every((op) => !op.id.startsWith('codec.'))).toBe(true);
  });

  it('produces byte-identical operations across re-emits (deterministic)', async () => {
    const hooks: CodecControlHooks = {
      onFieldEvent: (event, ctx) => [
        wrapOp({
          id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
          label: 'hook',
          operationClass: 'additive',
          invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
          target: { id: 'sqlite' },
          precheck: [],
          execute: [{ description: 'side', sql: '-- side' }],
          postcheck: [],
        }),
      ],
    };
    const fc = makeFrameworkComponents(hooks);

    const c = contract(
      {
        User: table({
          id: col({ codecId: 'sqlite/text@1' }),
          email: col({ codecId: HOOKED_CODEC }),
          name: col({ codecId: HOOKED_CODEC }),
        }),
      },
      'to',
    );

    const a = planner.plan({
      contract: c,
      schema: { tables: {} },
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: fc,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    const b = planner.plan({
      contract: c,
      schema: { tables: {} },
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: fc,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(a.kind).toBe('success');
    expect(b.kind).toBe('success');
    if (a.kind !== 'success' || b.kind !== 'success') return;
    const [aOps, bOps] = await Promise.all([
      Promise.all(a.plan.operations),
      Promise.all(b.plan.operations),
    ]);
    expect(JSON.stringify(aOps)).toBe(JSON.stringify(bOps));
  });
});
