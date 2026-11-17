import type { PgvectorNearestMethods } from '@prisma/orm-extension-pgvector/runtime';
import type { Collection } from '@prisma/orm-postgres/orm-client';
import type { PostgresClient } from '@prisma/orm-postgres/runtime';
import { expectTypeOf } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';

export type Loaded = [PostgresClient<Contract>, PgvectorNearestMethods];

expectTypeOf<keyof Collection<Contract, 'Post'>['using']>().toEqualTypeOf<
  'post_search' | 'post_title_search' | 'embedding_nearest'
>();
