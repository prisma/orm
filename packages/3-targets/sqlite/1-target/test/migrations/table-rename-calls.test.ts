import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { sqliteTableRenameCall } from '../../src/core/migrations/table-rename-calls';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import {
  contractOf,
  HANDLE_INDEX_HASH,
  handleIndex,
  type ProfileSpec,
} from './rename-table-fixtures';

const OLD_INDEX = `userProfile_handle_idx_${HANDLE_INDEX_HASH}`;
const NEW_INDEX = `UserProfile_handle_idx_${HANDLE_INDEX_HASH}`;
const RENAME = { namespaceId: UNBOUND_NAMESPACE_ID, from: 'userProfile', to: 'UserProfile' };

function callFor(origin: ProfileSpec, destination: ProfileSpec) {
  return sqliteTableRenameCall({
    previous: sqliteContractToSchema(contractOf('userProfile', origin, 'from'), sqliteTestTypes),
    contract: contractOf('UserProfile', destination, 'to'),
    rename: RENAME,
    frameworkComponents: sqliteTestComponents,
  });
}

const derivedIndex: ProfileSpec = { indexes: (tableName) => [handleIndex(tableName)] };

describe('sqliteTableRenameCall', () => {
  it('pairs each index named after the old table with its replacement under the new name', () => {
    const call = callFor(derivedIndex, derivedIndex);

    expect(call.companions.map((companion) => companion.label)).toEqual([
      `Drop index ${OLD_INDEX} on UserProfile`,
      `Create index ${NEW_INDEX} on UserProfile`,
    ]);
  });

  it('pairs an index an introspected origin names after the old table', () => {
    const introspected: ProfileSpec = {
      indexes: (tableName) => [
        { ...handleIndex(tableName), naming: { kind: 'exact', name: OLD_INDEX } },
      ],
    };
    const call = callFor(introspected, derivedIndex);

    expect(
      call.indexReplacements.map(({ drop, create }) => [drop.indexName, create.indexName]),
    ).toEqual([[OLD_INDEX, NEW_INDEX]]);
  });

  it('leaves an explicitly named index alone', () => {
    const named: ProfileSpec = {
      indexes: (tableName) => [
        { ...handleIndex(tableName), naming: { kind: 'exact', name: 'profile_handle' } },
      ],
    };

    expect(callFor(named, named).companions).toEqual([]);
  });

  it('is the table rename itself, with the resolved names', () => {
    expect(callFor({}, {})).toMatchObject({
      factoryName: 'renameTable',
      oldTableName: 'userProfile',
      tableName: 'UserProfile',
      companions: [],
    });
  });
});
