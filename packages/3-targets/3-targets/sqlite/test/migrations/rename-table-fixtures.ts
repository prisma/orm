import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type ForeignKeyInput,
  type IndexInput,
  SqlStorage,
  StorageTable,
  type UniqueConstraintInput,
} from '@internal/sql-contract/types';
import { computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';

export const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const integer = { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false };
const text = { nativeType: 'text', codecId: 'sqlite/text@1', nullable: false };

export interface ProfileSpec {
  readonly uniques?: readonly UniqueConstraintInput[];
  readonly foreignKeys?: (tableName: string) => readonly ForeignKeyInput[];
  readonly indexes?: (tableName: string) => readonly IndexInput[];
}

export function reference(tableName: string, columns: readonly string[]) {
  return { namespaceId: UNBOUND_NAMESPACE_ID, tableName, columns };
}

export function contractOf(
  profileTableName: string,
  spec: ProfileSpec,
  hashSeed: string,
): Contract<SqlStorage> {
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
              [profileTableName]: new StorageTable({
                columns: { id: integer, email: text, handle: text, accountId: integer },
                primaryKey: { columns: ['id'] },
                uniques: spec.uniques ?? [],
                indexes: spec.indexes?.(profileTableName) ?? [],
                foreignKeys: spec.foreignKeys?.(profileTableName) ?? [],
              }),
              account: new StorageTable({
                columns: { id: integer },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
              post: new StorageTable({
                columns: { id: integer, profileId: integer },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: reference('post', ['profileId']),
                    target: reference(profileTableName, ['id']),
                  },
                ],
              }),
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
  };
}

export const HANDLE_INDEX_HASH = computeIndexContentHash({ columns: ['handle'], unique: false });

export function handleIndex(tableName: string): IndexInput {
  return {
    columns: ['handle'],
    naming: { kind: 'wire', prefix: `${tableName}_handle_idx`, hash: HANDLE_INDEX_HASH },
    where: undefined,
    unique: false,
    type: undefined,
    options: undefined,
  };
}
