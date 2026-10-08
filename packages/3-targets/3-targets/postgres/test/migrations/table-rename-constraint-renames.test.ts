import { describe, expect, it } from 'vitest';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { constraintRenamesForTableRename } from '../../src/core/migrations/table-rename-constraint-renames';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { contractOf, type ProfileSpec, reference } from './rename-table-fixtures';

function unrenamedTable(spec: ProfileSpec): PostgresTableSchemaNode {
  const schema = postgresContractToSchema(
    contractOf('UserProfile', spec, 'to'),
    postgresTypeComponents,
  );
  const table = schema.namespaces['public']?.tables['UserProfile'];
  if (table === undefined) throw new Error('table UserProfile missing');
  return table;
}

describe('constraintRenamesForTableRename', () => {
  it.each([
    ['primary key', { primaryKey: { columns: ['id'] } }],
    ['unique constraint', { uniques: [{ columns: ['email'] }] }],
    [
      'foreign key',
      {
        foreignKeys: (tableName: string) => [
          { source: reference(tableName, ['accountId']), target: reference('account', ['id']) },
        ],
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, ProfileSpec]>)(
    'refuses a renamed table whose %s has no name, since the working schema names them all',
    (_kind, spec) => {
      const table = unrenamedTable(spec);
      expect(() =>
        constraintRenamesForTableRename({
          schemaName: 'public',
          previous: table,
          next: table,
        }),
      ).toThrow(/has no name/);
    },
  );

  function tableWith(input: {
    readonly uniques?: readonly { readonly columns: readonly string[]; readonly name?: string }[];
    readonly foreignKeys?: readonly {
      readonly columns: readonly string[];
      readonly referencedTable: string;
      readonly referencedColumns: readonly string[];
      readonly name?: string;
    }[];
  }): PostgresTableSchemaNode {
    return new PostgresTableSchemaNode({
      name: 'UserProfile',
      columns: {
        id: { name: 'id', nativeType: 'int4', nullable: false },
        email: { name: 'email', nativeType: 'text', nullable: false },
        accountId: { name: 'accountId', nativeType: 'int4', nullable: false },
      },
      foreignKeys: [...(input.foreignKeys ?? [])],
      uniques: [...(input.uniques ?? [])],
      indexes: [],
      policies: [],
      rlsEnabled: false,
    });
  }

  const labels = (previous: PostgresTableSchemaNode, next: PostgresTableSchemaNode) =>
    constraintRenamesForTableRename({ schemaName: 'public', previous, next }).map(
      (call) => call.label,
    );

  it('pairs two foreign keys on the same columns with two different destination foreign keys', () => {
    const previous = tableWith({
      foreignKeys: [
        {
          columns: ['accountId'],
          referencedTable: 'account',
          referencedColumns: ['id'],
          name: 'fk_a',
        },
        {
          columns: ['accountId'],
          referencedTable: 'member',
          referencedColumns: ['id'],
          name: 'fk_b',
        },
      ],
    });
    const next = tableWith({
      foreignKeys: [
        {
          columns: ['accountId'],
          referencedTable: 'account',
          referencedColumns: ['id'],
          name: 'profile_account_fk',
        },
        {
          columns: ['accountId'],
          referencedTable: 'member',
          referencedColumns: ['id'],
          name: 'profile_member_fk',
        },
      ],
    });

    expect(labels(previous, next)).toEqual([
      'Rename foreign key "fk_a" to "profile_account_fk" on "UserProfile"',
      'Rename foreign key "fk_b" to "profile_member_fk" on "UserProfile"',
    ]);
  });

  it('pairs each foreign key with the destination key to its own table, whatever their order', () => {
    const previous = tableWith({
      foreignKeys: [
        {
          columns: ['accountId'],
          referencedTable: 'account',
          referencedColumns: ['id'],
          name: 'fk_a',
        },
        {
          columns: ['accountId'],
          referencedTable: 'member',
          referencedColumns: ['id'],
          name: 'fk_b',
        },
      ],
    });
    const next = tableWith({
      foreignKeys: [
        {
          columns: ['accountId'],
          referencedTable: 'member',
          referencedColumns: ['id'],
          name: 'profile_member_fk',
        },
        {
          columns: ['accountId'],
          referencedTable: 'account',
          referencedColumns: ['id'],
          name: 'profile_account_fk',
        },
      ],
    });

    expect(labels(previous, next)).toEqual([
      'Rename foreign key "fk_a" to "profile_account_fk" on "UserProfile"',
      'Rename foreign key "fk_b" to "profile_member_fk" on "UserProfile"',
    ]);
  });

  it('pairs a later foreign key with the destination key to its own table when an earlier key has no such match', () => {
    const previous = tableWith({
      foreignKeys: [
        {
          columns: ['accountId'],
          referencedTable: 'legacy',
          referencedColumns: ['id'],
          name: 'fk_legacy',
        },
        {
          columns: ['accountId'],
          referencedTable: 'account',
          referencedColumns: ['id'],
          name: 'fk_account',
        },
      ],
    });
    const next = tableWith({
      foreignKeys: [
        {
          columns: ['accountId'],
          referencedTable: 'account',
          referencedColumns: ['id'],
          name: 'profile_account_fk',
        },
        {
          columns: ['accountId'],
          referencedTable: 'member',
          referencedColumns: ['id'],
          name: 'profile_member_fk',
        },
      ],
    });

    expect(labels(previous, next)).toEqual([
      'Rename foreign key "fk_legacy" to "profile_member_fk" on "UserProfile"',
      'Rename foreign key "fk_account" to "profile_account_fk" on "UserProfile"',
    ]);
  });

  it('pairs a destination unique constraint with one of two duplicate uniques only', () => {
    const previous = tableWith({
      uniques: [
        { columns: ['email'], name: 'userProfile_email_key' },
        { columns: ['email'], name: 'userProfile_email_key1' },
      ],
    });
    const next = tableWith({ uniques: [{ columns: ['email'] }] });

    expect(labels(previous, next)).toEqual([
      'Rename unique constraint "userProfile_email_key" to "UserProfile_email_key" on "UserProfile"',
    ]);
  });
});
