/**
 * Branded model handles for the Supabase contract space.
 *
 * Each handle is built via `extensionModel` branded `spaceId: 'supabase'` with
 * its real domain model name, namespace, table name, and columns — so
 * `AuthUser.refs.id` is a cross-space `TargetFieldRef` carrying
 * `spaceId:'supabase'`, `namespaceId:'auth'`, `tableName:'users'`.
 *
 * Columns mirror the shipped contract (`src/contract/contract.json`); the
 * handle↔contract consistency test (`test/contract-handles.test.ts`) asserts
 * they agree so any drift is caught at test time.
 */
import { extensionModel, field } from '@internal/sql-contract-ts/contract-builder';

const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;
// Supabase's `auth` tables are read by application code, so these carry the Temporal
// representation — the same choice a user authoring the column themselves would get from a bare
// `Timestamptz`.
const pgTimestamptz = {
  codecId: 'pg/timestamptz-temporal@1',
  nativeType: 'timestamptz',
} as const;

export const AuthUser = extensionModel(
  'AuthUser',
  {
    namespace: 'auth',
    fields: {
      id: field.column(pgText).id(),
      email: field.column(pgText),
      created_at: field.column(pgTimestamptz),
      updated_at: field.column(pgTimestamptz),
    },
    table: 'users',
  },
  'supabase' as const,
);

export const AuthIdentity = extensionModel(
  'AuthIdentity',
  {
    namespace: 'auth',
    fields: {
      id: field.column(pgText).id(),
      user_id: field.column(pgText),
      provider: field.column(pgText),
      created_at: field.column(pgTimestamptz),
      updated_at: field.column(pgTimestamptz),
    },
    table: 'identities',
  },
  'supabase' as const,
);

export const StorageBucket = extensionModel(
  'StorageBucket',
  {
    namespace: 'storage',
    fields: {
      id: field.column(pgText).id(),
      name: field.column(pgText),
      created_at: field.column(pgTimestamptz),
      updated_at: field.column(pgTimestamptz),
    },
    table: 'buckets',
  },
  'supabase' as const,
);

export const StorageObject = extensionModel(
  'StorageObject',
  {
    namespace: 'storage',
    fields: {
      id: field.column(pgText).id(),
      bucket_id: field.column(pgText),
      name: field.column(pgText),
      created_at: field.column(pgTimestamptz),
      updated_at: field.column(pgTimestamptz),
    },
    table: 'objects',
  },
  'supabase' as const,
);
