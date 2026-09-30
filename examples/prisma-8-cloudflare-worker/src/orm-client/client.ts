import { orm } from '@prisma/orm-postgres/orm-client';
import type { PostgresServerlessConnection } from '@prisma/orm-postgres/serverless';
import type { Contract } from '../prisma/contract.d';
import { PostCollection, UserCollection } from './collections';

export function createOrmClient(
  db: Pick<PostgresServerlessConnection<Contract>, 'runtime' | 'context'>,
) {
  return orm({
    runtime: db.runtime(),
    context: db.context,
    collections: {
      User: UserCollection,
      Post: PostCollection,
    },
  }).public;
}
