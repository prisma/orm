/**
 * A namespace the origin contract declares and the destination does not: its tables are dropped,
 * each a data-loss question about its model, and then the schema. A schema the origin never
 * declared, such as Supabase's `auth`, is left alone, and so is everything without an origin
 * contract.
 */
import { createHash } from 'node:crypto';
import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  planOriginOf,
  type ResolvedMigrationStatement,
  type SchemaOwnership,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import type { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { stubLowerer } from './rename-table-fixtures';

const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };
const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };

function table(namespaceId: string, name: string, references?: string): StorageTable {
  return new StorageTable({
    columns: { id: int4, ...(references === undefined ? {} : { refId: int4 }) },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys:
      references === undefined
        ? []
        : [
            {
              source: { namespaceId, tableName: name, columns: ['refId'] },
              target: { namespaceId, tableName: references, columns: ['id'] },
            },
          ],
  });
}

function policyEntries(namespaceId: string, policies: readonly (readonly [string, string])[]) {
  if (policies.length === 0) return {};
  const nodes = policies.map(
    ([tableName, name]) =>
      new PostgresRlsPolicy({
        naming: { kind: 'exact', name },
        tableName,
        namespaceId,
        operation: 'select',
        roles: ['app_user'],
        using: '(id > 0)',
        withCheck: undefined,
        permissive: true,
      }),
  );
  return {
    policy: Object.fromEntries(nodes.map((policy) => [policy.name, policy])),
    rls: Object.fromEntries(
      policies.map(([tableName]) => [
        tableName,
        new PostgresRlsEnablement({ tableName, namespaceId }),
      ]),
    ),
  };
}

/** A contract with one model per table, named after it with a capital letter, in each namespace. */
function contractOf(
  namespaces: Readonly<Record<string, readonly string[]>>,
  seed: string,
  references: Readonly<Record<string, string>> = {},
  policies: Readonly<Record<string, string>> = {},
): Contract<SqlStorage> {
  const modelName = (tableName: string) => `${tableName[0]?.toUpperCase()}${tableName.slice(1)}`;
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(createHash('sha256').update(seed).digest('hex')),
      namespaces: Object.fromEntries(
        Object.entries(namespaces).map(([id, tables]) => [
          id,
          postgresCreateNamespace({
            id,
            entries: {
              table: Object.fromEntries(
                tables.map((name) => [name, table(id, name, references[name])]),
              ),
              ...policyEntries(
                id,
                tables.flatMap((name) => {
                  const policy = policies[name];
                  return policy === undefined ? [] : [[name, policy] as const];
                }),
              ),
            },
          }),
        ]),
      ),
    }),
    roots: {},
    domain: {
      namespaces: Object.fromEntries(
        Object.entries(namespaces).map(([id, tables]) => [
          id,
          {
            models: Object.fromEntries(
              tables.map((name) => [
                modelName(name),
                {
                  fields: {},
                  relations: {},
                  storage: { table: name, namespaceId: id, fields: {} },
                },
              ]),
            ),
          },
        ]),
      ),
    },
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  options: {
    readonly fromContract?: Contract<SqlStorage> | null;
    readonly schema?: PostgresDatabaseSchemaNode;
    readonly ownership?: SchemaOwnership;
    readonly statements?: readonly ResolvedMigrationStatement[];
  } = {},
) {
  const fromContract = options.fromContract === undefined ? from : options.fromContract;
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: options.schema ?? postgresContractToSchema(from, postgresTypeComponents),
    policy: ALL_CLASSES,
    fromContract,
    origin: fromContract === null ? null : planOriginOf(fromContract),
    statements: options.statements ?? [],
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
    ...(options.ownership === undefined ? {} : { ownership: options.ownership }),
  });
}

/** A sibling space that declares `table` in `namespaceId`, and the namespaces `namespaces`. */
function sibling(
  declared: { readonly namespaceId: string; readonly table: string },
  namespaces: readonly string[] = [],
): SchemaOwnership {
  return {
    declaresEntity: (coordinate) =>
      coordinate.entityKind === 'table' &&
      coordinate.namespaceId === declared.namespaceId &&
      coordinate.entityName === declared.table,
    namespaceDeclaringSpaces: (namespaceId) =>
      namespaces.includes(namespaceId) ? [APP_SPACE_ID, 'sibling'] : [APP_SPACE_ID],
  };
}

async function planned(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  const ops = await Promise.all(result.plan.operations);
  return { labels: ops.map((op) => op.label), dataLoss: result.dataLoss };
}

const withBilling = contractOf({ public: ['user'], billing: ['invoice', 'receipt'] }, 'with');
const withoutBilling = contractOf({ public: ['user'] }, 'without');

describe('Postgres planner, a namespace the destination removes', () => {
  it('drops each of its tables, each a question about its model, and then the schema', async () => {
    expect(await planned(plan(withBilling, withoutBilling))).toEqual({
      labels: ['Drop table "invoice"', 'Drop table "receipt"', 'Drop schema "billing"'],
      dataLoss: [
        expect.objectContaining({
          operationIndex: 0,
          subject: { kind: 'model', namespaceId: asNamespaceId('billing'), model: 'Invoice' },
        }),
        expect.objectContaining({
          operationIndex: 1,
          subject: { kind: 'model', namespaceId: asNamespaceId('billing'), model: 'Receipt' },
        }),
      ],
    });
  });

  it('leaves the namespace alone without an origin contract', async () => {
    expect(await planned(plan(withBilling, withoutBilling, { fromContract: null }))).toEqual({
      labels: [],
      dataLoss: [],
    });
  });

  it('leaves alone a schema the origin never declared, such as auth', async () => {
    const live = postgresContractToSchema(
      contractOf({ public: ['user'], auth: ['users'] }, 'live'),
      postgresTypeComponents,
    );

    expect(
      await planned(
        plan(withoutBilling, withoutBilling, { schema: live, fromContract: withoutBilling }),
      ),
    ).toEqual({ labels: [], dataLoss: [] });
  });

  it('drops the tables of public but never the schema itself', async () => {
    const inPublic = contractOf({ public: ['user'], billing: ['invoice'] }, 'in-public');
    const onlyBilling = contractOf({ billing: ['invoice'] }, 'only-billing');

    expect((await planned(plan(inPublic, onlyBilling))).labels).toEqual(['Drop table "user"']);
  });

  it("keeps a removed schema another space declares, and its table there, and drops the app's table in it", async () => {
    const origin = contractOf({ public: ['user'], auth: ['profiles'] }, 'auth-origin');
    const live = postgresContractToSchema(
      contractOf({ public: ['user'], auth: ['profiles', 'users'] }, 'auth-live'),
      postgresTypeComponents,
    );

    expect(
      await planned(
        plan(origin, contractOf({ public: ['user'] }, 'auth-destination'), {
          schema: live,
          ownership: sibling({ namespaceId: 'auth', table: 'users' }, ['auth']),
        }),
      ),
    ).toEqual({
      labels: ['Drop table "profiles"'],
      dataLoss: [
        expect.objectContaining({
          subject: { kind: 'model', namespaceId: asNamespaceId('auth'), model: 'Profiles' },
        }),
      ],
    });
  });

  it('drops a table of the removed schema whose name a sibling space uses in another namespace', async () => {
    const origin = contractOf({ public: ['account'], billing: ['user'] }, 'user-origin');

    expect(
      (
        await planned(
          plan(origin, contractOf({ public: ['account'] }, 'user-destination'), {
            ownership: sibling({ namespaceId: UNBOUND_NAMESPACE_ID, table: 'user' }),
          }),
        )
      ).labels,
    ).toEqual(['Drop table "user"', 'Drop schema "billing"']);
  });

  it('drops a table of the removed schema before the table its foreign key references', async () => {
    const origin = contractOf({ public: ['user'], billing: ['invoice', 'receipt'] }, 'fk-origin', {
      receipt: 'invoice',
    });

    expect((await planned(plan(origin, withoutBilling))).labels).toEqual([
      'Drop table "receipt"',
      'Drop table "invoice"',
      'Drop schema "billing"',
    ]);
  });

  it('plans the drop of two tables of the removed schema that reference each other', async () => {
    const origin = contractOf(
      { public: ['user'], billing: ['invoice', 'receipt'] },
      'cycle-origin',
      { receipt: 'invoice', invoice: 'receipt' },
    );

    expect((await planned(plan(origin, withoutBilling))).labels).toEqual([
      'Drop table "invoice"',
      'Drop table "receipt"',
      'Drop schema "billing"',
    ]);
  });

  it('drops a table with its policies, so the policies raise no question of their own', async () => {
    const origin = contractOf(
      { public: ['user'], billing: ['invoice'] },
      'policy-origin',
      {},
      { invoice: 'invoice_read' },
    );
    const result = plan(origin, withoutBilling);

    expect(await planned(result)).toMatchObject({
      labels: ['Drop table "invoice"', 'Drop schema "billing"'],
    });
    expect(result.kind === 'success' && result.accessChanges).toEqual([]);
  });

  describe('the default namespace public', () => {
    it('plans nothing for an unchanged contract whose models are all in a named namespace', async () => {
      const onlyBilling = contractOf({ public: [], billing: ['invoice'] }, 'only-billing-public');

      expect(await planned(plan(onlyBilling, onlyBilling))).toEqual({ labels: [], dataLoss: [] });
    });

    it('asks about the last model removed from public, and keeps the schema', async () => {
      const before = contractOf({ public: ['user'], billing: ['invoice'] }, 'last-before');
      const after = contractOf({ public: [], billing: ['invoice'] }, 'last-after');

      expect(await planned(plan(before, after))).toEqual({
        labels: ['Drop table "user"'],
        dataLoss: [
          expect.objectContaining({
            subject: { kind: 'model', namespaceId: asNamespaceId('public'), model: 'User' },
          }),
        ],
      });
    });

    it('moves a model out of a public the destination no longer declares, and keeps the schema', async () => {
      const before = contractOf({ public: ['user'] }, 'public-before');
      const after = contractOf({ app: ['user'] }, 'app-after');
      const move: ResolvedMigrationStatement = {
        kind: 'rename',
        entity: 'model',
        from: { namespaceId: asNamespaceId('public'), model: 'User' },
        to: { namespaceId: asNamespaceId('app'), model: 'User' },
      };

      expect((await planned(plan(before, after, { statements: [move] }))).labels).toEqual([
        'Create schema "app"',
        'Move table "user" to schema "app"',
      ]);
    });

    it('asks about a model of a public the destination no longer declares', async () => {
      const before = contractOf({ public: ['user'] }, 'public-before-2');
      const after = contractOf({ app: ['user'] }, 'app-after-2');

      expect((await planned(plan(before, after))).dataLoss).toEqual([
        expect.objectContaining({
          subject: { kind: 'model', namespaceId: asNamespaceId('public'), model: 'User' },
        }),
      ]);
    });
  });
});

describe('Postgres planner, the namespaces a plan removes and adds', () => {
  const namespacesOf = (result: ReturnType<typeof plan>) =>
    result.kind === 'success' ? result.namespaces : undefined;
  const withFinance = contractOf({ public: ['user'], finance: ['invoice', 'receipt'] }, 'finance');

  it('reports the removed namespace and the one the destination adds', () => {
    expect(namespacesOf(plan(withBilling, withFinance))).toEqual({
      removed: ['billing'],
      added: ['finance'],
    });
  });

  it('reports neither for a namespace a statement renames', () => {
    expect(
      namespacesOf(
        plan(withBilling, withFinance, {
          statements: [
            {
              kind: 'rename',
              entity: 'namespace',
              from: asNamespaceId('billing'),
              to: asNamespaceId('finance'),
            },
          ],
        }),
      ),
    ).toEqual({ removed: [], added: [] });
  });

  it('never reports public as removed or added, nor anything without an origin contract', () => {
    const inPublic = contractOf({ public: ['user'], billing: ['invoice'] }, 'in-public');
    const onlyBilling = contractOf({ billing: ['invoice'] }, 'only-billing');

    expect(namespacesOf(plan(inPublic, onlyBilling))).toEqual({ removed: [], added: [] });
    expect(namespacesOf(plan(onlyBilling, inPublic))).toEqual({ removed: [], added: [] });
    expect(namespacesOf(plan(withBilling, withFinance, { fromContract: null }))).toEqual({
      removed: [],
      added: [],
    });
  });
});
