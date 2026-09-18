import type {
  ExtractAggregateTypes,
  ExtractFieldOutputTypes,
  ExtractStorageColumnTypes,
} from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';
import type postgres from '../../src/exports/runtime';
import type { Contract } from '../fixtures/generated/contract';

const contract = defineContract({}, ({ field, model, rel }) => {
  const User = model('User', {
    fields: {
      id: field.int().id(),
      email: field.text(),
      name: field.text().optional(),
      tags: field.text().many().optional(),
    },
  });
  const Post = model('Post', {
    fields: {
      id: field.int().id(),
      authorId: field.int(),
      editorId: field.int().optional(),
      title: field.text(),
    },
    relations: {
      author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
      editor: rel.belongsTo(() => User, { from: 'editorId', to: 'id' }),
    },
  });
  return {
    models: { User: User.relations({ posts: rel.hasMany(Post, { by: 'authorId' }) }), Post },
  };
});
declare const db: ReturnType<typeof postgres<typeof contract>>;

test('infers scalar and list rows without emitted contract declarations', () => {
  expectTypeOf(db.orm.public.User.all()).resolves.toEqualTypeOf<
    Array<{
      id: number;
      email: string;
      name: string | null;
      tags: ReadonlyArray<string> | null;
    }>
  >();
  // @ts-expect-error scalar numeric filters reject strings
  db.orm.public.User.where({ id: 'wrong' });
  // @ts-expect-error scalar string filters reject lists
  db.orm.public.User.where({ email: ['wrong'] });
  // @ts-expect-error undeclared models do not become an index signature
  db.orm.public.Missing;
  // @ts-expect-error undeclared namespaces do not become an index signature
  db.orm.missing.User;
});

test('retains required, nullable, lazy, and to-many relation metadata', () => {
  expectTypeOf(
    db.orm.public.Post.select('id')
      .include('editor', (editor) => editor.select('email'))
      .all(),
  ).resolves.toEqualTypeOf<
    Array<{
      id: number;
      editor: { email: string } | null;
    }>
  >();
  expectTypeOf(db.orm.public.Post.select('title').include('author').all()).resolves.toEqualTypeOf<
    Array<{
      title: string;
      author: {
        id: number;
        email: string;
        name: string | null;
        tags: ReadonlyArray<string> | null;
      };
    }>
  >();
  expectTypeOf(
    db.orm.public.User.select('id')
      .include('posts', (posts) => posts.select('title'))
      .all(),
  ).resolves.toEqualTypeOf<
    Array<{
      id: number;
      posts: Array<{ title: string }>;
    }>
  >();
});

type Materialize<Value> = Value extends object
  ? { [Key in keyof Value]: Materialize<Value[Key]> }
  : Value;

test('types aggregate results from the target descriptors', () => {
  expectTypeOf<Materialize<ExtractAggregateTypes<typeof contract>>>().toEqualTypeOf<
    ExtractAggregateTypes<Contract>
  >();
  expectTypeOf(
    db.orm.public.User.aggregate((aggregate) => ({
      total: aggregate.count(),
      sum: aggregate.sum('id'),
      largest: aggregate.max('email'),
    })),
  ).resolves.toEqualTypeOf<{ total: number; sum: number | null; largest: string | null }>();
  db.orm.public.User.aggregate((aggregate) => ({
    // @ts-expect-error Postgres cannot sum text
    invalid: aggregate.sum('email'),
  }));
});

test('keeps prepared scalar comparisons scalar', async () => {
  const prepared = await db.prepare({ email: 'pg/text@1' }, (params) =>
    db.sql.public.User.select('id', 'email')
      .where((fields, fns) => fns.eq(fields.email, params.email))
      .build(),
  );
  expectTypeOf<Parameters<typeof prepared.query>[1]>().toEqualTypeOf<{ readonly email: string }>();
});

const direct = defineContract({
  extensions: {},
  models: {
    Account: model('Account', {
      fields: {
        id: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' } as const).id(),
      },
    }),
  },
});
declare const directDb: ReturnType<typeof postgres<typeof direct>>;
test('infers direct definitions with empty extensions', () => {
  expectTypeOf(directDb.orm.public.Account.all()).resolves.toEqualTypeOf<Array<{ id: number }>>();
  // @ts-expect-error unknown scaffold properties remain rejected
  defineContract({ unknownOption: true });
});

const namespaced = defineContract(
  { namespaces: ['auth'], naming: { tables: 'snake_case', columns: 'snake_case' } },
  ({ field, model }) => ({
    models: {
      AccountProfile: model('AccountProfile', {
        namespace: 'auth',
        fields: {
          id: field.int().id(),
          loginName: field.text(),
        },
      })
        .relations({})
        .attributes({})
        .sql({}),
    },
  }),
);
declare const namespacedDb: ReturnType<typeof postgres<typeof namespaced>>;
test('retains scaffold naming and model namespaces through fluent stages', () => {
  expectTypeOf<
    ExtractFieldOutputTypes<typeof namespaced>['auth']['AccountProfile']['loginName']
  >().toEqualTypeOf<string>();
  expectTypeOf<
    ExtractStorageColumnTypes<typeof namespaced>['auth']['account_profile']['login_name']
  >().toEqualTypeOf<string>();
  expectTypeOf(namespacedDb.orm.auth.AccountProfile.all()).resolves.toEqualTypeOf<
    Array<{ id: number; loginName: string }>
  >();
  // @ts-expect-error a model exists only in its authored namespace
  namespacedDb.orm.public.AccountProfile;
});
