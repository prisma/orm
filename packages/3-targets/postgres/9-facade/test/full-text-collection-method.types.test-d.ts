import type { HasOrderBy, HasWhere } from '@internal/sql-orm-client';
import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { describe, expectTypeOf, test } from 'vitest';
import type { Contract } from '../../../../3-extensions/sql-orm-client/test/fixtures/generated/contract';
import type { PostgresClient } from '../src/runtime/postgres';
import type { PostgresServerlessClient } from '../src/runtime/postgres-serverless';

type Connection = Awaited<ReturnType<PostgresServerlessClient<Contract>['connect']>>;

declare const client: PostgresClient<Contract>;
declare const connection: Connection;

const q = websearchToTsquery('zebra');

describe('the full-text collection method', () => {
  test('is offered by postgres() for each full-text index, with no type argument but the contract', () => {
    expectTypeOf<keyof typeof client.orm.public.User.using>().toEqualTypeOf<'users_search'>();
    expectTypeOf(client.orm.public.User.using.users_search(q)).toExtend<HasWhere & HasOrderBy>();
    expectTypeOf(client.orm.public.User.using.users_search(q)).not.toBeAny();
  });

  test('is offered by the serverless client', () => {
    expectTypeOf<keyof typeof connection.orm.public.User.using>().toEqualTypeOf<'users_search'>();
  });

  test('takes a tsquery, not a string', () => {
    // @ts-expect-error a bare string is not a tsquery
    client.orm.public.User.using.users_search('zebra');
  });
});
