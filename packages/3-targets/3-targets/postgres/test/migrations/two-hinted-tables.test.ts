import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID, type ControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { reference, stubLowerer } from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const int4 = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };

/** Two tables whose foreign keys reference each other, under the given names. */
function contractOf(
  names: { readonly profile: string; readonly post: string },
  hashSeed: string,
  hints?: Readonly<Record<string, string>>,
): Contract<SqlStorage> {
  const table = (own: string, column: string, target: string) =>
    new StorageTable({
      columns: { id: int4, [column]: int4 },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [{ source: reference(own, [column]), target: reference(target, ['id']) }],
    });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
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
  adapter: { create: () => stubLowerer as unknown as SqlControlAdapter<'postgres'> },
  target: { kind: 'target', familyId: 'sql', targetId: 'postgres' },
  extensions: [],
} as unknown as ControlStack<'sql', 'postgres'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new PostgresContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

const foreignKeyRenames = (ops: readonly Op[]) =>
  ops.map((op) => op.label).filter((label) => label.startsWith('Rename foreign key'));

describe.each([
  { order: 'the referencing table first', profile: 'Member', post: 'Article' },
  { order: 'the referenced table first', profile: 'Member', post: 'Zine' },
])('two hinted tables that reference each other, renaming $order', ({ profile, post }) => {
  const destination = contractOf({ profile, post }, 'b'.repeat(64), {
    [profile]: 'Profile',
    [post]: 'Post',
  });
  const expected = [
    `Rename foreign key "Profile_postId_fkey" to "${profile}_postId_fkey" on "${profile}"`,
    `Rename foreign key "Post_profileId_fkey" to "${post}_profileId_fkey" on "${post}"`,
  ];

  it('renames both foreign keys to the names derived from the new tables when planned', async () => {
    const result = createPostgresMigrationPlanner(stubLowerer).plan({
      contract: destination,
      schema: postgresContractToSchema(contractOf(START, 'from'), []),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const ops = await Promise.all(result.plan.operations);

    expect([...foreignKeyRenames(ops)].sort()).toEqual([...expected].sort());
  });

  it('renames both foreign keys the same way through hand-written renameTable calls', async () => {
    const startJson = jsonOf(contractOf(START, 'from'));
    const endJson = jsonOf(destination);
    const [first, second] = [
      { table: 'Profile', to: profile },
      { table: 'Post', to: post },
    ].sort((a, b) => (a.to < b.to ? -1 : 1));
    class HandWritten extends PostgresMigration {
      override readonly startContractJson = startJson;
      override readonly endContractJson = endJson;
      override get operations(): readonly Promise<Op>[] {
        return [...this.renameTable(first!), ...this.renameTable(second!)];
      }
    }
    const ops = await Promise.all(new HandWritten(stack).operations);

    expect([...foreignKeyRenames(ops)].sort()).toEqual([...expected].sort());
  });
});
