import type { Contract } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  SchemaEntityCoordinate,
  SchemaOwnership,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  HINT_CONTRADICTED_CODE,
  HINT_FOREIGN_TABLE_CODE,
  resolveHints,
} from '../src/core/migrations/hints';
import type { SchemaTables } from '../src/core/migrations/schema-tables';
import { TestSqlContractSerializer } from './test-sql-contract-serializer';

const column = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };

function sqlTable(...columns: string[]) {
  return {
    columns: Object.fromEntries(columns.map((name) => [name, column])),
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

function contractWith(
  tables: Record<string, Record<string, ReturnType<typeof sqlTable>>>,
  hints: unknown,
): Contract<SqlStorage> {
  return new TestSqlContractSerializer().deserializeContract({
    ...createSqlContract({ tables }),
    hints,
  });
}

const userContract = contractWith(
  { public: { User: sqlTable('id', 'firstName') } },
  { namespaces: { public: { tables: { User: { was: 'Profile' } } } } },
);

function origin(...tables: string[]): SchemaTables {
  const present = new Set(tables);
  return {
    hasTable: (namespaceId, table) => present.has(`${namespaceId}.${table}`),
    hasColumn: () => false,
    namespacesWithTable: () => [],
  };
}

const widening: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};
const additiveOnly: MigrationOperationPolicy = { allowedOperationClasses: ['additive'] };

function ownedBy(owners: Record<string, string>): SchemaOwnership {
  const ownerOf = (coordinate: SchemaEntityCoordinate) =>
    owners[`${coordinate.namespaceId}.${coordinate.entityKind}.${coordinate.entityName}`];
  return { declaresEntity: (coordinate) => ownerOf(coordinate) !== undefined, ownerOf };
}

function resolve(input: {
  readonly contract?: Contract<SqlStorage>;
  readonly origin: SchemaTables;
  readonly policy?: MigrationOperationPolicy;
  readonly ownership?: SchemaOwnership;
}) {
  return resolveHints({
    contract: input.contract ?? userContract,
    origin: input.origin,
    policy: input.policy ?? widening,
    ownership: input.ownership,
    spaceId: 'app',
  });
}

const nothing = {
  tableRenames: [],
  columnRenames: [],
  tableDrops: [],
  columnDrops: [],
  conflicts: [],
};

describe('resolveHints for a table rename', () => {
  it('renames when the origin has the old table and not the new one', () => {
    expect(resolve({ origin: origin('public.Profile') })).toEqual({
      ...nothing,
      tableRenames: [{ namespaceId: 'public', from: 'Profile', to: 'User' }],
    });
  });

  it('produces nothing for the same origin when the policy does not allow widening', () => {
    expect(resolve({ origin: origin('public.Profile'), policy: additiveOnly })).toEqual(nothing);
  });

  it('produces nothing when the origin already has the new table', () => {
    expect(resolve({ origin: origin('public.User') })).toEqual(nothing);
  });

  it('produces nothing when the origin has neither table', () => {
    expect(resolve({ origin: origin() })).toEqual(nothing);
  });

  it('produces nothing when the origin has both tables and the policy does not allow widening', () => {
    expect(
      resolve({ origin: origin('public.Profile', 'public.User'), policy: additiveOnly }),
    ).toEqual(nothing);
  });

  it('rejects the hint when the origin has both tables', () => {
    expect(resolve({ origin: origin('public.Profile', 'public.User') })).toEqual({
      ...nothing,
      conflicts: [
        {
          kind: 'hintRejected',
          summary:
            'MIGRATION.HINT_CONTRADICTED: the rename hint on table "User" (was "Profile") cannot apply: namespace "public" has both "Profile" and "User".',
          why: 'A rename hint applies only while the old name exists and the new one does not. If "Profile" was already renamed, remove the hint. If "Profile" is a different table that should stay, remove the hint and give the model another table name.',
          location: { namespaceId: 'public', entityKind: 'table', entityName: 'User' },
          meta: {
            code: HINT_CONTRADICTED_CODE,
            from: 'Profile',
            to: 'User',
          },
        },
      ],
    });
  });
});

describe('resolveHints and contract space ownership', () => {
  it('rejects a rename of a table another contract space owns', () => {
    expect(
      resolve({
        origin: origin('public.Profile'),
        ownership: ownedBy({ 'public.table.Profile': 'audit' }),
      }),
    ).toEqual({
      ...nothing,
      conflicts: [
        {
          kind: 'hintRejected',
          summary:
            'MIGRATION.HINT_FOREIGN_TABLE: the rename hint on table "User" (was "Profile") names a table that contract space "audit" owns.',
          why: 'A hint may rename only tables this contract space declares. Remove the hint, or move the table into this space first.',
          location: { namespaceId: 'public', entityKind: 'table', entityName: 'User' },
          meta: { code: HINT_FOREIGN_TABLE_CODE, from: 'Profile', to: 'User' },
        },
      ],
    });
  });

  it('produces nothing for a table another space owns when the policy does not allow widening', () => {
    expect(
      resolve({
        origin: origin('public.Profile'),
        policy: additiveOnly,
        ownership: ownedBy({ 'public.table.Profile': 'audit' }),
      }),
    ).toEqual(nothing);
  });

  it('renames a table the planned space itself owns', () => {
    expect(
      resolve({
        origin: origin('public.Profile'),
        ownership: ownedBy({ 'public.table.Profile': 'app' }),
      }).tableRenames,
    ).toEqual([{ namespaceId: 'public', from: 'Profile', to: 'User' }]);
  });
});

describe('resolveHints on an inconsistent contract', () => {
  it('returns the consistency error as its only conflict', () => {
    const contract = contractWith(
      { public: { User: sqlTable('id') } },
      { namespaces: { public: { tables: { Customer: { was: 'Client' } } } } },
    );
    expect(resolve({ contract, origin: origin('public.Client') })).toEqual({
      ...nothing,
      conflicts: [
        {
          kind: 'hintRejected',
          summary:
            'Contract hints: table "Customer" carries a hint but the contract does not declare it.',
          meta: { code: 'CONTRACT.HINT_INVALID' },
        },
      ],
    });
  });
});

describe('resolveHints ordering and purity', () => {
  const contract = contractWith(
    {
      zeta: { b: sqlTable('id'), a: sqlTable('id') },
      alpha: { y: sqlTable('id'), x: sqlTable('id') },
      mid: { n: sqlTable('id'), account: sqlTable('id'), User: sqlTable('id') },
    },
    {
      namespaces: {
        zeta: { tables: { b: { was: 'old_b' }, a: { was: 'old_a' } } },
        alpha: { tables: { y: { was: 'old_y' }, x: { was: 'old_x' } } },
        mid: {
          tables: {
            n: { was: 'old_n' },
            account: { was: 'old_account' },
            User: { was: 'old_User' },
          },
        },
      },
    },
  );
  const everyOldTable = origin(
    'zeta.old_b',
    'zeta.old_a',
    'alpha.old_y',
    'alpha.old_x',
    'mid.old_n',
    'mid.old_account',
    'mid.old_User',
  );

  it('visits namespaces, then tables, in code-point order', () => {
    expect(resolve({ contract, origin: everyOldTable }).tableRenames).toEqual([
      { namespaceId: 'alpha', from: 'old_x', to: 'x' },
      { namespaceId: 'alpha', from: 'old_y', to: 'y' },
      { namespaceId: 'mid', from: 'old_User', to: 'User' },
      { namespaceId: 'mid', from: 'old_account', to: 'account' },
      { namespaceId: 'mid', from: 'old_n', to: 'n' },
      { namespaceId: 'zeta', from: 'old_a', to: 'a' },
      { namespaceId: 'zeta', from: 'old_b', to: 'b' },
    ]);
  });

  it('gives the same result for the same input', () => {
    expect(resolve({ contract, origin: everyOldTable })).toEqual(
      resolve({ contract, origin: everyOldTable }),
    );
  });
});
