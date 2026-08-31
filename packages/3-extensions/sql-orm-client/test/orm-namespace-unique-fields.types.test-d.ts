import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { orm } from '../src/orm';
import type { RelationPredicate, ShorthandWhereFilter } from '../src/types';
import { createMockRuntime, type TestContract } from './helpers';

/**
 * Regression: the same bare model name in two namespaces, each with a
 * namespace-UNIQUE field, must be queryable through its own namespace facet.
 *
 * The generated fixture declares `public.User` with a unique `email` field.
 * Here we extend it with an `auth` namespace that declares the SAME bare model
 * name `User` but with a DIFFERENT unique field `token`.
 *
 * `OrmNamespace<C, _, Ns>['User']` threads the `Ns` coordinate into the read
 * row, which resolves the model's fields within its namespace (the per-namespace
 * `domain.namespaces[Ns]` block + the nested `FieldOutputTypes[Ns]` map) rather
 * than the flat first-name-wins model map. So each namespace's read row carries
 * its own unique field, and the other namespace's unique field is absent.
 */

interface TwoNamespaceContract extends Omit<TestContract, 'domain' | 'storage'> {
  readonly domain: Omit<TestContract['domain'], 'namespaces'> & {
    readonly namespaces: TestContract['domain']['namespaces'] & {
      readonly auth: {
        readonly models: {
          readonly User: {
            readonly fields: {
              readonly id: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
              };
              readonly token: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
              };
            };
            readonly relations: Record<string, never>;
            readonly storage: {
              readonly table: 'auth_users';
              readonly namespaceId: 'auth';
              readonly fields: {
                readonly id: { readonly column: 'id' };
                readonly token: { readonly column: 'token' };
              };
            };
          };
        };
      };
    };
  };
  readonly storage: Omit<TestContract['storage'], 'namespaces'> & {
    readonly namespaces: TestContract['storage']['namespaces'] & {
      readonly auth: {
        readonly id: 'auth';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: {
            readonly auth_users: {
              readonly columns: {
                readonly id: {
                  readonly nativeType: 'int4';
                  readonly codecId: 'pg/int4@1';
                  readonly nullable: false;
                };
                readonly token: {
                  readonly nativeType: 'text';
                  readonly codecId: 'pg/text@1';
                  readonly nullable: false;
                };
              };
              readonly primaryKey: { readonly columns: readonly ['id'] };
              readonly uniques: readonly [];
              readonly indexes: readonly [];
              readonly foreignKeys: readonly [];
            };
          };
          readonly type: Record<string, never>;
        };
      };
    };
  };
}

declare const context: ExecutionContext<TwoNamespaceContract>;
const db = orm({ runtime: createMockRuntime(), context });

test('the public-namespace User facet read row carries its unique field `email`', async () => {
  const row = await db.public.User.first();
  if (row) {
    expectTypeOf(row.email).toEqualTypeOf<string>();
  }
});

test('the auth-namespace User facet read row carries its unique field `token`', async () => {
  const row = await db.auth.User.first();
  if (row) {
    expectTypeOf(row.token).toEqualTypeOf<string>();
  }
});

/**
 * The same per-namespace coordinate that resolves the read row also governs the
 * `create` / `update` / `where` INPUT types: each namespace's `User` accepts its
 * own unique field and rejects the other namespace's. If the flat first-name-wins
 * `ModelsOf` map were governing input resolution, both facets would accept the
 * first-declared `User`'s field.
 *
 * Each `User` here gives its primary key a storage default, so the namespace's
 * unique field is the only required create field — keeping the create assertions
 * focused on the field that distinguishes the two namespaces.
 */
type DefaultedPk = {
  readonly nativeType: 'int4';
  readonly codecId: 'pg/int4@1';
  readonly nullable: false;
  readonly default: { readonly kind: 'function'; readonly expression: 'nextval' };
};

interface WriteCollisionContract extends Omit<TestContract, 'domain' | 'storage'> {
  readonly domain: Omit<TestContract['domain'], 'namespaces'> & {
    readonly namespaces: {
      readonly public: {
        readonly models: {
          readonly User: {
            readonly fields: {
              readonly id: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
              };
              readonly email: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
              };
            };
            readonly relations: Record<string, never>;
            readonly storage: {
              readonly table: 'users';
              readonly namespaceId: 'public';
              readonly fields: {
                readonly id: { readonly column: 'id' };
                readonly email: { readonly column: 'email' };
              };
            };
          };
        };
      };
      readonly auth: {
        readonly models: {
          readonly User: {
            readonly fields: {
              readonly id: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
              };
              readonly token: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
              };
            };
            readonly relations: Record<string, never>;
            readonly storage: {
              readonly table: 'auth_users';
              readonly namespaceId: 'auth';
              readonly fields: {
                readonly id: { readonly column: 'id' };
                readonly token: { readonly column: 'token' };
              };
            };
          };
        };
      };
    };
  };
  readonly storage: Omit<TestContract['storage'], 'namespaces'> & {
    readonly namespaces: {
      readonly public: {
        readonly id: 'public';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: {
            readonly users: {
              readonly columns: {
                readonly id: DefaultedPk;
                readonly email: {
                  readonly nativeType: 'text';
                  readonly codecId: 'pg/text@1';
                  readonly nullable: false;
                };
              };
              readonly primaryKey: { readonly columns: readonly ['id'] };
              readonly uniques: readonly [{ readonly columns: readonly ['email'] }];
              readonly indexes: readonly [];
              readonly foreignKeys: readonly [];
            };
          };
          readonly type: Record<string, never>;
        };
      };
      readonly auth: {
        readonly id: 'auth';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: {
            readonly auth_users: {
              readonly columns: {
                readonly id: DefaultedPk;
                readonly token: {
                  readonly nativeType: 'text';
                  readonly codecId: 'pg/text@1';
                  readonly nullable: false;
                };
              };
              readonly primaryKey: { readonly columns: readonly ['id'] };
              readonly uniques: readonly [{ readonly columns: readonly ['token'] }];
              readonly indexes: readonly [];
              readonly foreignKeys: readonly [];
            };
          };
          readonly type: Record<string, never>;
        };
      };
    };
  };
}

declare const writeContext: ExecutionContext<WriteCollisionContract>;
const writeDb = orm({ runtime: createMockRuntime(), context: writeContext });

test('standalone filters require and honor the namespace before the model name', () => {
  const publicFilter: ShorthandWhereFilter<WriteCollisionContract, 'public', 'User'> = {
    email: 'a@example.com',
  };
  const authPredicate: RelationPredicate<WriteCollisionContract, 'auth', 'User'> = (user) =>
    user.token.eq('tok');

  writeDb.public.User.where(publicFilter);
  writeDb.auth.User.where(authPredicate);

  // @ts-expect-error namespace coordinate is required
  const missingNamespace: ShorthandWhereFilter<WriteCollisionContract, 'User'> = {};
  // @ts-expect-error namespace coordinate is required
  const missingPredicateNamespace: RelationPredicate<WriteCollisionContract, 'User'> =
    authPredicate;
  // @ts-expect-error namespace must exist in the contract
  const unknownNamespace: ShorthandWhereFilter<WriteCollisionContract, 'missing', 'User'> = {};
  void missingNamespace;
  void missingPredicateNamespace;
  void unknownNamespace;

  const wrongPublicFilter: ShorthandWhereFilter<WriteCollisionContract, 'public', 'User'> = {
    // @ts-expect-error token belongs to auth.User, not public.User
    token: 'tok',
  };

  writeDb.public.User.where(wrongPublicFilter);
});

test('the auth-namespace User facet resolves create/where inputs to its own field `token`', async () => {
  await writeDb.auth.User.create({ token: 'tok' });
  writeDb.auth.User.where({ token: 'tok' });
});

test('the public-namespace User facet resolves create/where inputs to its own field `email`', async () => {
  await writeDb.public.User.create({ email: 'a@example.com' });
  writeDb.public.User.where({ email: 'a@example.com' });
});

test('each User facet rejects the unique field of the other namespace in create/where', async () => {
  // @ts-expect-error `email` belongs to public.User, not auth.User
  await writeDb.auth.User.create({ email: 'a@example.com' });
  // @ts-expect-error `email` belongs to public.User, not auth.User
  writeDb.auth.User.where({ email: 'a@example.com' });
  // @ts-expect-error `token` belongs to auth.User, not public.User
  await writeDb.public.User.create({ token: 'tok' });
  // @ts-expect-error `token` belongs to auth.User, not public.User
  writeDb.public.User.where({ token: 'tok' });
});
