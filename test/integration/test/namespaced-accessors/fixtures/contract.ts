import type { TargetPackRef } from '@internal/framework-components/components';
import {
  postgres18,
  postgresContractCapabilities,
  postgresDriver,
} from '@internal/postgres/config';
import {
  buildSqlContractFromDefinition,
  type ModelNode,
} from '@internal/postgres/contract-builder';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { postgresTypeLookups } from '../../postgres-type-lookups';

const idDescriptor = { codecId: 'pg/int4@1' } as const;
const textDescriptor = { codecId: 'pg/text@1' } as const;

// This contract is built without the facade's defineContract, so it states the capabilities that defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver] }) would.
const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  capabilities: postgresContractCapabilities([...postgres18, ...postgresDriver]),
};

// Same bare table name `users` in BOTH namespaces with DIFFERENT columns:
// `public.users` has `email`, `auth.users` has `token`.
const publicUser: ModelNode = {
  modelName: 'User',
  tableName: 'users',
  namespaceId: 'public',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false, many: false },
    {
      fieldName: 'email',
      columnName: 'email',
      descriptor: textDescriptor,
      nullable: false,
      many: false,
    },
  ],
  id: { columns: ['id'] },
};

const authUser: ModelNode = {
  modelName: 'User',
  tableName: 'users',
  namespaceId: 'auth',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false, many: false },
    {
      fieldName: 'token',
      columnName: 'token',
      descriptor: textDescriptor,
      nullable: false,
      many: false,
    },
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
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false, many: false },
    {
      fieldName: 'userId',
      columnName: 'user_id',
      descriptor: idDescriptor,
      nullable: false,
      many: false,
    },
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

// The same model name `Note`, with the same fields, in BOTH namespaces: a
// collection's namespace is the only thing that tells the two apart.
function note(namespaceId: 'public' | 'auth'): ModelNode {
  return {
    modelName: 'Note',
    tableName: 'notes',
    namespaceId,
    fields: [
      { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false },
      { fieldName: 'body', columnName: 'body', descriptor: textDescriptor, nullable: false },
    ],
    id: { columns: ['id'] },
  };
}

export const contract = buildSqlContractFromDefinition(
  {
    warnings: undefined,
    target: postgresTargetPack,
    namespaces: ['public', 'auth'],
    models: [publicUser, profile, authUser, note('public'), note('auth')],
    createNamespace: postgresCreateNamespace,
  },
  postgresTypeLookups.codecLookup,
  postgresTypeLookups.dataTypeLookup,
);
