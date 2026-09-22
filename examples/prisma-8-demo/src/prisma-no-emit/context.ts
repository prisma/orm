import pgvector from '@prisma/orm-extension-pgvector/runtime';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { orm } from '@prisma/orm-postgres/orm-client';
import postgres from '@prisma/orm-postgres/runtime';
import { contract } from '../../prisma/contract';
import { MissingNamespaceError } from '../errors';
import { PostCollection, UserCollection } from '../orm-client/collections';

// No-emit flow: hand the TypeScript-authored contract straight to the
// `postgres()` facade with deferred binding (no url at construction). The
// facade owns stack/context/sql/enums, so the demo no longer hand-wires them.
export const db = postgres<typeof contract>({ contract, extensions: [pgvector] });

export const context = db.context;
export const stack = db.stack;
export const enums = db.enums;
export const sql = db.sql.public;

export function createOrmClient(runtime: Runtime) {
  // The demo builds runtimes externally (custom pool/middleware) and passes
  // them in, so the ORM client is built against that runtime via the `orm()`
  // builder rather than the facade's own lazily-bound `db.orm`.
  const client = orm({
    runtime,
    context,
    collections: {
      User: UserCollection,
      Post: PostCollection,
    },
  });
  const publicNs = client['public'];
  if (publicNs === undefined) {
    throw new MissingNamespaceError('public', 'ORM client');
  }
  return publicNs;
}
