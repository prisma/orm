import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID, type ControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import type { SqlitePlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { SqliteMigration } from '../../src/core/migrations/sqlite-migration';
import { SqliteContractSerializer } from '../../src/core/sqlite-contract-serializer';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';
import { reference, stubLowerer } from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const integer = { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false };

/** Two tables whose foreign keys reference each other, under the given names. */
function contractOf(
  names: { readonly profile: string; readonly post: string },
  hashSeed: string,
  hints?: Readonly<Record<string, string>>,
): Contract<SqlStorage> {
  const table = (own: string, column: string, target: string) =>
    new StorageTable({
      columns: { id: integer, [column]: integer },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [{ source: reference(own, [column]), target: reference(target, ['id']) }],
    });
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              [names.profile]: table(names.profile, 'postId', names.post),
              [names.post]: table(names.post, 'profileId', names.profile),
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
    ...(hints === undefined
      ? {}
      : {
          hints: {
            namespaces: {
              [UNBOUND_NAMESPACE_ID]: {
                tables: Object.fromEntries(
                  Object.entries(hints).map(([table, was]) => [table, { was }]),
                ),
              },
            },
          },
        }),
  };
}

const START = { profile: 'Profile', post: 'Post' } as const;

const stack = {
  adapter: { create: () => stubLowerer as unknown as SqlControlAdapter<'sqlite'> },
  target: { kind: 'target', familyId: 'sql', targetId: 'sqlite' },
  extensions: [],
} as unknown as ControlStack<'sql', 'sqlite'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new SqliteContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

describe.each([
  { order: 'the referencing table first', profile: 'Member', post: 'Article' },
  { order: 'the referenced table first', profile: 'Member', post: 'Zine' },
])('two hinted tables that reference each other, renaming $order', ({ profile, post }) => {
  const destination = contractOf({ profile, post }, 'b'.repeat(64), {
    [profile]: 'Profile',
    [post]: 'Post',
  });
  const renames = [
    { table: 'Profile', to: profile },
    { table: 'Post', to: post },
  ].sort((a, b) => (a.to < b.to ? -1 : 1));

  it('plans only the two renames, the same operations as hand-written renameTable calls', async () => {
    const result = createSqliteMigrationPlanner(stubLowerer).plan({
      contract: destination,
      schema: sqliteContractToSchema(contractOf(START, 'from')),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const planned = await Promise.all(result.plan.operations);

    const startJson = jsonOf(contractOf(START, 'from'));
    const endJson = jsonOf(destination);
    class HandWritten extends SqliteMigration {
      override readonly startContractJson = startJson;
      override readonly endContractJson = endJson;
      override get operations(): readonly Promise<Op>[] {
        return renames.flatMap((rename) => this.renameTable(rename));
      }
    }
    const handWritten = await Promise.all(new HandWritten(stack).operations);

    expect(planned.map((op) => op.label)).toEqual(
      renames.map(({ table, to }) => `Rename table ${table} to ${to}`),
    );
    expect(planned).toEqual(handWritten);
  });
});
