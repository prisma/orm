import {
  int4Column,
  textColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import { field } from '@internal/sql-contract-ts/contract-builder';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { Filtered, Ordered } from '../src/collection-types';
import type { orm } from '../src/orm';
import type { CollectionWithFields, DeclaredField } from '../src/scopes';
import type { CodecField } from '../src/types';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import type { Contract as ScopeNamespaceContract } from './fixtures/scope-namespace/generated/contract';
import {
  createScopesOrm,
  type SoftDeleteContract,
  type SoftPostCollection,
} from './scopes-fixture';

type Contract = SoftDeleteContract;
type DeletedAt = CodecField<Contract, 'pg/timestamptz-temporal@1', true>;

const { client, db, plain } = createScopesOrm();

const notDeleted = client.scope(
  { deletedAt: field.column(timestamptzTemporalColumn).optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);

const deletedLast = client.scope(
  { deletedAt: { codecId: 'pg/timestamptz-temporal@1', nullable: true } },
  (rows) => rows.orderBy((r) => r.deletedAt.desc()).limit(10),
);

const liveNewestFirst = client.scope(
  { deletedAt: field.column(timestamptzTemporalColumn).optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()).orderBy((r) => r.deletedAt.desc()),
);

const titled = (term: string) =>
  client.scope({ title: field.column(textColumn) }, (rows) => rows.where((r) => r.title.eq(term)));

declare const tasks: Collection<PolyContract, 'Task'>;
declare const flag: boolean;
declare const polyClient: ReturnType<typeof orm<PolyContract>>;
declare const scopeNamespaceClient: ReturnType<typeof orm<ScopeNamespaceContract>>;

class LivePostCollection extends Collection<Contract, 'Post'> {
  live() {
    return this.apply(notDeleted);
  }
}

describe('client.scope', () => {
  test('types the body against the declared fields only', () => {
    client.scope({ deletedAt: field.column(timestamptzTemporalColumn).optional() }, (rows) =>
      rows.where((r) => {
        expectTypeOf(r.deletedAt).toEqualTypeOf<DeletedAt>();
        expectTypeOf(r).toEqualTypeOf<{ readonly deletedAt: DeletedAt }>();
        return r.deletedAt.isNull();
      }),
    );
  });

  test('the body cannot name a field it did not declare', () => {
    client.scope({ deletedAt: field.column(timestamptzTemporalColumn).optional() }, (rows) =>
      // @ts-expect-error title is not a declared field
      rows.where((r) => r.title.eq('x')),
    );
  });

  test('the body cannot select or include', () => {
    client.scope({ deletedAt: field.column(timestamptzTemporalColumn).optional() }, (rows) =>
      // @ts-expect-error select is not available in the body of a scope for any model
      rows.select('deletedAt'),
    );
    client.scope({ deletedAt: field.column(timestamptzTemporalColumn).optional() }, (rows) =>
      // @ts-expect-error include is not available in the body of a scope for any model
      rows.include('user'),
    );
  });

  test('is accepted on every model that has the fields and keeps the receiver type', () => {
    expectTypeOf(plain.Post.apply(notDeleted)).toEqualTypeOf<Filtered<typeof plain.Post>>();
    expectTypeOf(plain.Comment.apply(notDeleted)).toEqualTypeOf<Filtered<typeof plain.Comment>>();
    expectTypeOf(db.Post.apply(notDeleted)).toEqualTypeOf<Filtered<SoftPostCollection>>();
    expectTypeOf(db.Post.apply(notDeleted).popular()).toEqualTypeOf<
      Filtered<Filtered<SoftPostCollection>>
    >();
  });

  test('works after where, after select, in an include refinement and on this', async () => {
    const filtered = db.Post.where({ title: 'x' });
    expectTypeOf(filtered.apply(notDeleted)).toEqualTypeOf<Filtered<typeof filtered>>();
    const selected = plain.Post.select('id', 'title');
    expectTypeOf(selected.apply(notDeleted)).toEqualTypeOf<Filtered<typeof selected>>();
    const user = await plain.User.include('posts', (posts) => posts.apply(notDeleted)).first();
    expectTypeOf(user!.posts[0]!.title).toEqualTypeOf<string>();
    expectTypeOf<ReturnType<LivePostCollection['live']>>().toEqualTypeOf<
      Filtered<LivePostCollection>
    >();
  });

  test('records the filter and the order the body applied', () => {
    expectTypeOf(plain.Post.apply(deletedLast)).toEqualTypeOf<Ordered<typeof plain.Post>>();
    expectTypeOf(plain.Post.apply(liveNewestFirst)).toEqualTypeOf<
      Ordered<Filtered<typeof plain.Post>>
    >();
    plain.Post.apply(notDeleted).update({ title: 'x' });
    plain.Post.apply(deletedLast).cursor({ id: 1 });
    // @ts-expect-error the body applied no filter, so update is refused
    plain.Post.apply(deletedLast).update({ title: 'x' });
    // @ts-expect-error the body applied no order, so cursor is refused
    plain.Post.apply(notDeleted).cursor({ id: 1 });
  });

  test('a scope with a parameter is a function that returns a scope', () => {
    expectTypeOf(plain.Post.apply(titled('orm'))).toEqualTypeOf<Filtered<typeof plain.Post>>();
    // @ts-expect-error Comment has no title field
    plain.Comment.apply(titled('orm'));
  });

  test('refuses a model that lacks a declared field', () => {
    // @ts-expect-error Tag has no deletedAt field
    plain.Tag.apply(notDeleted);
  });

  test('refuses a field of another column type', () => {
    const viewsAsText = client.scope({ views: field.column(textColumn) }, (rows) => rows.limit(1));
    // @ts-expect-error Post.views is an int4 column, not text
    plain.Post.apply(viewsAsText);
  });

  test('refuses a field of another nullability', () => {
    const createdAtNullable = client.scope(
      { createdAt: field.column(timestamptzTemporalColumn).optional() },
      (rows) => rows.where((r) => r.createdAt.isNull()),
    );
    // @ts-expect-error Post.createdAt is not nullable
    plain.Post.apply(createdAtNullable);
    const deletedAtRequired = client.scope(
      { deletedAt: field.column(timestamptzTemporalColumn) },
      (rows) => rows.limit(1),
    );
    // @ts-expect-error Post.deletedAt is nullable
    plain.Post.apply(deletedAtRequired);
  });

  test('refuses a relation declared as a field', () => {
    const byUser = client.scope({ user: field.column(int4Column) }, (rows) => rows.limit(1));
    // @ts-expect-error user is a relation of Post, not a field
    plain.Post.apply(byUser);
  });

  test('refuses a field that only a variant has', () => {
    const bySeverity = polyClient.scope({ severity: field.column(textColumn) }, (rows) =>
      rows.where((r) => r.severity.eq('high')),
    );
    // @ts-expect-error severity is a field of the Bug variant, not of Task
    tasks.apply(bySeverity);
    // @ts-expect-error severity is a field of the Bug variant, not of Task
    tasks.variant('Bug').apply(bySeverity);
  });

  test('a body cannot claim a filter it may not have applied', () => {
    const deletedAt = { deletedAt: field.column(timestamptzTemporalColumn).optional() } as const;
    client.scope(deletedAt, (rows) => {
      let query = rows.where((r) => r.deletedAt.isNull());
      if (flag) {
        // @ts-expect-error rows has no filter, so it cannot replace a filtered query
        query = rows;
      }
      return query;
    });
    const maybeFiltered = client.scope(deletedAt, (rows) => {
      let query = rows;
      if (flag) query = query.where((r) => r.deletedAt.isNull());
      return query;
    });
    expectTypeOf(plain.Post.apply(maybeFiltered)).toEqualTypeOf<typeof plain.Post>();
    // @ts-expect-error the scope may not have filtered, so deleteAll is refused
    plain.Post.apply(maybeFiltered).deleteAll();
    client.scope<typeof deletedAt, { readonly hasWhere: true; readonly hasOrderBy: true }>(
      deletedAt,
      // @ts-expect-error the body applied no filter, so it cannot be typed as filtering
      (rows: unknown) => rows,
    );
  });

  test('the body returns the collection it received, not another one', () => {
    client.scope(
      { deletedAt: field.column(timestamptzTemporalColumn).optional() },
      // @ts-expect-error a Post collection is not the collection the body received
      () => plain.Post.where((p) => p.deletedAt.isNull()),
    );
  });

  test('the refusal names the field the model lacks', () => {
    type Fields = {
      readonly deletedAt: DeclaredField<'pg/timestamptz-temporal@1', true>;
      readonly title: DeclaredField<'pg/text@1', false>;
    };
    type Refusal = 'the model has no field with the column type and nullability the scope declares';
    type ForModel<Model> = Extract<
      CollectionWithFields<Contract, Fields>,
      { readonly modelName: Model }
    >;
    expectTypeOf<ForModel<'Comment'>[Refusal]>().toEqualTypeOf<'title'>();
    expectTypeOf<ForModel<'Tag'>[Refusal]>().toEqualTypeOf<'deletedAt' | 'title'>();
    expectTypeOf<ForModel<'Post'>>().not.toHaveProperty(
      'the model has no field with the column type and nullability the scope declares',
    );
    const deletedTitled = client.scope(
      {
        deletedAt: field.column(timestamptzTemporalColumn).optional(),
        title: field.column(textColumn),
      },
      (rows) => rows.limit(1),
    );
    plain.Post.apply(deletedTitled);
    // @ts-expect-error Comment has deletedAt but no title, and the message names title
    plain.Comment.apply(deletedTitled);
  });

  test('refuses a codec the contract does not have, at the declaration', () => {
    client.scope(
      // @ts-expect-error pg/txt@1 is not a codec of the contract
      { title: { codecId: 'pg/txt@1', nullable: false } },
      (rows) => rows.limit(1),
    );
  });

  test('a contract with a namespace named scope has no scope method', () => {
    expectTypeOf(scopeNamespaceClient.scope).toHaveProperty('Audit');
    // @ts-expect-error scope is the namespace, not the method
    scopeNamespaceClient.scope(
      { title: { codecId: 'pg/text@1', nullable: false } },
      (rows: unknown) => rows,
    );
  });
});
