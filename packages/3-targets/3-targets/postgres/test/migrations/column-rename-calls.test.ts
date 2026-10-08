import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { postgresColumnRenameCall } from '../../src/core/migrations/table-rename-calls';
import { renameColumnInPostgresSchema } from '../../src/core/migrations/working-schema';
import { postgresTypeComponents } from '../postgres-type-lookups';
import {
  ORIGINAL_COLUMNS,
  type ProfileColumns,
  type ProfileObjects,
  profileContract,
} from './rename-column-fixtures';

const EMAIL_RENAMED: ProfileColumns = { ...ORIGINAL_COLUMNS, email: 'emailAddress' };

function labelsFor(
  objects: { readonly before: ProfileObjects; readonly after: ProfileObjects },
  rename: { readonly from: string; readonly to: string } = { from: 'email', to: 'emailAddress' },
  columns: ProfileColumns = EMAIL_RENAMED,
): readonly string[] {
  const call = postgresColumnRenameCall({
    previous: postgresContractToSchema(
      profileContract('from', { objects: objects.before }),
      postgresTypeComponents,
    ),
    contract: profileContract('to', { columns, objects: objects.after }),
    rename: { namespaceId: UNBOUND_NAMESPACE_ID, table: 'Profile', ...rename },
    frameworkComponents: postgresTypeComponents,
  });
  return [call.label, ...call.companions.map((companion) => companion.label)];
}

describe('postgresColumnRenameCall companions', () => {
  it('renames a derived unique constraint on the column to the name derived from the new column', () => {
    const unique = { emailUnique: {} };
    expect(labelsFor({ before: unique, after: unique })).toEqual([
      'Rename column "Profile"."email" to "emailAddress"',
      'Rename unique constraint "Profile_email_key" to "Profile_emailAddress_key" on "Profile"',
    ]);
  });

  it('renames a unique constraint to the explicit name the destination gives it', () => {
    expect(
      labelsFor({ before: { emailUnique: {} }, after: { emailUnique: { name: 'profile_email' } } }),
    ).toEqual([
      'Rename column "Profile"."email" to "emailAddress"',
      'Rename unique constraint "Profile_email_key" to "profile_email" on "Profile"',
    ]);
  });

  it('keeps an explicitly named unique constraint the destination names the same', () => {
    const named = { emailUnique: { name: 'profile_email' } };
    expect(labelsFor({ before: named, after: named })).toEqual([
      'Rename column "Profile"."email" to "emailAddress"',
    ]);
  });

  it('renames an index on the column to the wire name the destination gives it', () => {
    const indexed = { emailIndex: true };
    const [table, index, ...rest] = labelsFor({ before: indexed, after: indexed });
    expect(table).toBe('Rename column "Profile"."email" to "emailAddress"');
    expect(index).toMatch(
      /^Rename index "Profile_email_idx_[0-9a-f]+" to "Profile_emailAddress_idx_[0-9a-f]+" on "Profile"$/,
    );
    expect(rest).toEqual([]);
  });

  it('renames a derived foreign key on the column to the name derived from the new column', () => {
    const keyed = { accountForeignKey: {} };
    expect(
      labelsFor(
        { before: keyed, after: keyed },
        { from: 'accountId', to: 'ownerId' },
        { ...ORIGINAL_COLUMNS, account: 'ownerId' },
      ),
    ).toEqual([
      'Rename column "Profile"."accountId" to "ownerId"',
      'Rename foreign key "Profile_accountId_fkey" to "Profile_ownerId_fkey" on "Profile"',
    ]);
  });

  it('leaves the primary key alone when its column is renamed', () => {
    expect(
      labelsFor(
        { before: {}, after: {} },
        { from: 'id', to: 'profileId' },
        {
          ...ORIGINAL_COLUMNS,
          id: 'profileId',
        },
      ),
    ).toEqual(['Rename column "Profile"."id" to "profileId"']);
  });

  it('gives a check on the column no companion; the diff replaces it', () => {
    const checked = { emailCheck: true };
    expect(labelsFor({ before: checked, after: checked })).toEqual([
      'Rename column "Profile"."email" to "emailAddress"',
    ]);
  });
});

describe('renameColumnInPostgresSchema', () => {
  const previous = postgresContractToSchema(
    profileContract('from', { objects: { emailIndex: true, emailPartialIndex: true } }),
    postgresTypeComponents,
  );

  it('follows the column in foreign keys that reference it from another table', () => {
    const renamed = renameColumnInPostgresSchema(previous, {
      schemaName: 'public',
      table: 'Profile',
      from: 'id',
      to: 'profileId',
    });
    const post = renamed.namespaces['public']?.tables['post'];
    expect(post?.foreignKeys.map((fk) => [fk.referencedTable, fk.referencedColumns])).toEqual([
      ['Profile', ['profileId']],
    ]);
    expect(renamed.namespaces['public']?.tables['Profile']?.primaryKey?.columns).toEqual([
      'profileId',
    ]);
  });

  it('leaves the columns of an index with a predicate as they are', () => {
    const renamed = renameColumnInPostgresSchema(previous, {
      schemaName: 'public',
      table: 'Profile',
      from: 'email',
      to: 'emailAddress',
    });
    const indexes = renamed.namespaces['public']?.tables['Profile']?.indexes ?? [];
    expect(indexes.map((index) => [index.where === undefined, index.columns])).toEqual([
      [true, ['emailAddress']],
      [false, ['email']],
    ]);
    expect(Object.keys(renamed.namespaces['public']?.tables['Profile']?.columns ?? {})).toEqual([
      'id',
      'emailAddress',
      'accountId',
    ]);
  });
});
