import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type CheckConstraintInput,
  type ForeignKeyInput,
  type IndexInput,
  type PrimaryKeyInput,
  SqlStorage,
  StorageTable,
  type UniqueConstraintInput,
} from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';

export const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const text = { nativeType: 'text', codecId: 'pg/text@1', nullable: false };
const int4 = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };
export const NICKNAME_CHECK = 'length(nickname) > 0';

export interface ProfileSpec {
  readonly primaryKey?: PrimaryKeyInput;
  readonly uniques?: readonly UniqueConstraintInput[];
  readonly foreignKeys?: (tableName: string) => readonly ForeignKeyInput[];
  readonly indexes?: (tableName: string) => readonly IndexInput[];
  readonly checks?: (tableName: string) => readonly CheckConstraintInput[];
}

function profileTable(tableName: string, spec: ProfileSpec): StorageTable {
  return new StorageTable({
    columns: { id: int4, email: text, handle: text, nickname: text, accountId: int4 },
    primaryKey: spec.primaryKey ?? { columns: ['id'], name: 'profile_pk' },
    uniques: spec.uniques ?? [],
    indexes: spec.indexes?.(tableName) ?? [],
    foreignKeys: spec.foreignKeys?.(tableName) ?? [],
    checks: spec.checks?.(tableName) ?? [],
  });
}

export function reference(tableName: string, columns: readonly string[]) {
  return { namespaceId: UNBOUND_NAMESPACE_ID, tableName, columns };
}

const accountTable = new StorageTable({
  columns: { id: int4 },
  primaryKey: { columns: ['id'], name: 'account_pk' },
  uniques: [],
  indexes: [],
  foreignKeys: [],
});

export function postTable(profileTableName: string): StorageTable {
  return new StorageTable({
    columns: { id: int4, profileId: int4 },
    primaryKey: { columns: ['id'], name: 'post_pk' },
    uniques: [],
    indexes: [],
    foreignKeys: [
      {
        source: reference('post', ['profileId']),
        target: reference(profileTableName, ['id']),
      },
    ],
  });
}

export function contractOf(
  profileTableName: string,
  spec: ProfileSpec,
  hashSeed: string,
  extraTables: (profileTableName: string) => Record<string, StorageTable> = () => ({}),
  namespaceId: string = UNBOUND_NAMESPACE_ID,
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: {
        [namespaceId]: postgresCreateNamespace({
          id: namespaceId,
          entries: {
            table: {
              [profileTableName]: profileTable(profileTableName, spec),
              account: accountTable,
              ...extraTables(profileTableName),
            },
            policy: {},
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}
