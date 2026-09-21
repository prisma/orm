import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { test } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime, type TestContract } from './helpers';

type UserModel<Table extends string, Ns extends string> = {
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
    readonly table: Table;
    readonly namespaceId: Ns;
    readonly fields: {
      readonly id: { readonly column: 'id' };
      readonly email: { readonly column: 'email' };
    };
  };
};

type UserTable<Uniques extends readonly { readonly columns: readonly string[] }[]> = {
  readonly columns: {
    readonly id: {
      readonly nativeType: 'int4';
      readonly codecId: 'pg/int4@1';
      readonly nullable: false;
    };
    readonly email: {
      readonly nativeType: 'text';
      readonly codecId: 'pg/text@1';
      readonly nullable: false;
    };
  };
  readonly primaryKey: { readonly columns: readonly ['id'] };
  readonly uniques: Uniques;
  readonly indexes: readonly [];
  readonly foreignKeys: readonly [];
};

// `User.email` is unique in `public` but not in `auth`.
interface EmailUniqueOnlyInPublic extends Omit<TestContract, 'domain' | 'storage'> {
  readonly domain: Omit<TestContract['domain'], 'namespaces'> & {
    readonly namespaces: {
      readonly public: { readonly models: { readonly User: UserModel<'users', 'public'> } };
      readonly auth: { readonly models: { readonly User: UserModel<'auth_users', 'auth'> } };
    };
  };
  readonly storage: Omit<TestContract['storage'], 'namespaces'> & {
    readonly namespaces: {
      readonly public: {
        readonly id: 'public';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: {
            readonly users: UserTable<readonly [{ readonly columns: readonly ['email'] }]>;
          };
          readonly type: Record<string, never>;
        };
      };
      readonly auth: {
        readonly id: 'auth';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: { readonly auth_users: UserTable<readonly []> };
          readonly type: Record<string, never>;
        };
      };
    };
  };
}

declare const context: ExecutionContext<EmailUniqueOnlyInPublic>;
const db = orm({ runtime: createMockRuntime(), context });

test('a unique constraint counts only in its own namespace', () => {
  db.public.User.where({ email: 'a@example.com' }).delete();
  db.auth.User.where({ id: 1 }).delete();
  // @ts-expect-error auth.User.email is not unique; public.User's constraint must not leak in
  db.auth.User.where({ email: 'a@example.com' }).delete();
  // @ts-expect-error auth.User.email is not unique; public.User's constraint must not leak in
  db.auth.User.where({ email: 'a@example.com' }).update({ email: 'b@example.com' });
});
