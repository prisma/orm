import { describe, expect, it } from 'vitest';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { postgresTableRenameCall } from '../../src/core/migrations/table-rename-calls';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { contractOf, type ProfileSpec, reference } from './rename-table-fixtures';

const RENAME = { namespaceId: '__unbound__', from: 'userProfile', to: 'UserProfile' } as const;

function companionLabels(previousSpec: ProfileSpec, nextSpec: ProfileSpec): readonly string[] {
  const next = contractOf('UserProfile', nextSpec, 'to');
  const call = postgresTableRenameCall({
    previous: postgresContractToSchema(
      contractOf('userProfile', previousSpec, 'from'),
      postgresTypeComponents,
    ),
    contract: next,
    rename: RENAME,
    frameworkComponents: postgresTypeComponents,
  });
  return [call.label, ...call.companions.map((companion) => companion.label)];
}

const accountForeignKey = (tableName: string, name?: string) => ({
  source: reference(tableName, ['accountId']),
  target: reference('account', ['id']),
  ...(name === undefined ? {} : { name }),
});

describe('postgresTableRenameCall constraint companions', () => {
  it('renames constraints an introspected origin names after the old table to the names the destination derives', () => {
    const introspected: ProfileSpec = {
      primaryKey: { columns: ['id'], name: 'userProfile_pkey' },
      uniques: [{ columns: ['email'], name: 'userProfile_email_key' }],
      foreignKeys: () => [accountForeignKey('userProfile', 'userProfile_accountId_fkey')],
    };
    const destination: ProfileSpec = {
      primaryKey: { columns: ['id'] },
      uniques: [{ columns: ['email'] }],
      foreignKeys: (tableName) => [accountForeignKey(tableName)],
    };

    expect(companionLabels(introspected, destination)).toEqual([
      'Rename table "userProfile" to "UserProfile"',
      'Rename primary key "userProfile_pkey" to "UserProfile_pkey" on "UserProfile"',
      'Rename unique constraint "userProfile_email_key" to "UserProfile_email_key" on "UserProfile"',
      'Rename foreign key "userProfile_accountId_fkey" to "UserProfile_accountId_fkey" on "UserProfile"',
    ]);
  });

  it('renames an introspected constraint to the explicit name the destination gives it', () => {
    expect(
      companionLabels(
        { uniques: [{ columns: ['email'], name: 'userProfile_email_key' }] },
        { uniques: [{ columns: ['email'], name: 'profile_email_unique' }] },
      ),
    ).toEqual([
      'Rename table "userProfile" to "UserProfile"',
      'Rename unique constraint "userProfile_email_key" to "profile_email_unique" on "UserProfile"',
    ]);
  });

  it('renames an explicitly named constraint the destination leaves unnamed to the derived name', () => {
    expect(
      companionLabels(
        { uniques: [{ columns: ['email'], name: 'profile_email_unique' }] },
        { uniques: [{ columns: ['email'] }] },
      ),
    ).toEqual([
      'Rename table "userProfile" to "UserProfile"',
      'Rename unique constraint "profile_email_unique" to "UserProfile_email_key" on "UserProfile"',
    ]);
  });

  it('leaves a constraint alone when the destination has no constraint of the same kind and columns', () => {
    expect(
      companionLabels(
        { uniques: [{ columns: ['email'], name: 'userProfile_email_key' }] },
        { uniques: [{ columns: ['handle'] }] },
      ),
    ).toEqual(['Rename table "userProfile" to "UserProfile"']);
  });
});
