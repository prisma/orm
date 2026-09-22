import type { TargetPackRef } from '@internal/framework-components/components';
import {
  buildSqlContractFromDefinition,
  type ModelNode,
} from '@internal/postgres/contract-builder';
import { postgresCreateNamespace } from '@internal/target-postgres/types';

const idDescriptor = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const textDescriptor = { codecId: 'pg/text@1', nativeType: 'text' } as const;

// The TS author path merges capabilities from the target pack; a full CLI emit
// derives them from the codec/operation pipeline. For this author the runtime
// read/write paths (RETURNING reads, jsonAgg/lateral relation reads) need the
// capability flags present, so they ride on the target pack ref.
const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  capabilities: {
    postgres: { jsonAgg: true, lateral: true, returning: true, limit: true, orderBy: true },
    sql: { defaultInInsert: true, enums: true, lateral: true, returning: true },
  },
};

// Same bare table name `users` in BOTH namespaces with DIFFERENT columns:
// `public.users` has `email`, `auth.users` has `token`.
const publicUser: ModelNode = {
  modelName: 'User',
  tableName: 'users',
  namespaceId: 'public',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false },
    { fieldName: 'email', columnName: 'email', descriptor: textDescriptor, nullable: false },
  ],
  id: { columns: ['id'] },
};

const authUser: ModelNode = {
  modelName: 'User',
  tableName: 'users',
  namespaceId: 'auth',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false },
    { fieldName: 'token', columnName: 'token', descriptor: textDescriptor, nullable: false },
  ],
  id: { columns: ['id'] },
};

// `public.profile.user_id` carries a cross-namespace FK to `auth.users.id`, and
// the `user` relation targets `auth.User`.
const profile: ModelNode = {
  modelName: 'Profile',
  tableName: 'profile',
  namespaceId: 'public',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false },
    { fieldName: 'userId', columnName: 'user_id', descriptor: idDescriptor, nullable: false },
  ],
  id: { columns: ['id'] },
  foreignKeys: [
    {
      columns: ['user_id'],
      references: { model: 'User', table: 'users', columns: ['id'], namespaceId: 'auth' },
    },
  ],
  relations: [
    {
      fieldName: 'user',
      toModel: 'User',
      toTable: 'users',
      toNamespaceId: 'auth',
      cardinality: 'N:1',
      nullable: false,
      on: {
        parentTable: 'profile',
        parentColumns: ['user_id'],
        childTable: 'users',
        childColumns: ['id'],
      },
    },
  ],
};

export const contract = buildSqlContractFromDefinition({
  warnings: undefined,
  target: postgresTargetPack,
  namespaces: ['public', 'auth'],
  models: [publicUser, profile, authUser],
  createNamespace: postgresCreateNamespace,
});
