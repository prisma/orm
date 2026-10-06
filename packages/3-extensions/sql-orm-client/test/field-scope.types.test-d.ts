import {
  int4Column,
  jsonbColumn,
  textColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import { field } from '@internal/sql-contract-ts/contract-builder';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { Filtered, Ordered } from '../src/collection-types';
import type { orm } from '../src/orm';
import type { DeclaredField, MissingScopeFields, ScopeFieldsCheck } from '../src/scopes';
import type { CodecField, CodecListField, ModelAccessor } from '../src/types';
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
declare const anyModel: Collection<Contract, string>;
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
      (rows) => rows,
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
    expectTypeOf<
      MissingScopeFields<Contract, 'Comment', 'public', Fields>
    >().toEqualTypeOf<'title'>();
    expectTypeOf<MissingScopeFields<Contract, 'Tag', 'public', Fields>>().toEqualTypeOf<
      'deletedAt' | 'title'
    >();
    expectTypeOf<MissingScopeFields<Contract, 'Post', 'public', Fields>>().toBeNever();
    expectTypeOf<
      MissingScopeFields<Contract, 'Post' | 'Comment', 'public', Fields>
    >().toEqualTypeOf<'title'>();
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

  test('a receiver whose model cannot be read from its type is refused for that reason', () => {
    type Fields = { readonly deletedAt: DeclaredField<'pg/timestamptz-temporal@1', true> };
    expectTypeOf<
      keyof ScopeFieldsCheck<Contract, string, string, Fields>
    >().toEqualTypeOf<'the scope could not read the model of the collection from its type'>();
    expectTypeOf<
      keyof ScopeFieldsCheck<Contract, 'Tag', 'public', Fields>
    >().toEqualTypeOf<'the model has no field that matches the declaration in the scope'>();
    // @ts-expect-error call cannot infer the scope's type parameters, so the model cannot be read
    notDeleted.call(undefined, plain.Post);
    // @ts-expect-error apply cannot infer the scope's type parameters, so the model cannot be read
    notDeleted.apply(undefined, [plain.Post]);
    // @ts-expect-error the type of the collection names no single model
    anyModel.apply(notDeleted);
    expectTypeOf(notDeleted.bind(undefined)(plain.Post)).toEqualTypeOf<
      Filtered<typeof plain.Post>
    >();
  });

  test('a union of scopes is accepted only when their facts are the same', () => {
    const alsoNotDeleted = client.scope(
      { deletedAt: field.column(timestamptzTemporalColumn).optional() },
      (rows) => rows.where((r) => r.deletedAt.isNull()),
    );
    expectTypeOf(plain.Post.apply(flag ? notDeleted : alsoNotDeleted)).toEqualTypeOf<
      Filtered<typeof plain.Post>
    >();
    // @ts-expect-error one scope filters and the other orders, so the union has no single result
    plain.Post.apply(flag ? notDeleted : deletedLast);
  });

  test('a declaration of one value does not match a list field, and a list declaration matches only a list field', () => {
    const labelled = client.scope({ labels: field.column(textColumn) }, (rows) => rows.limit(1));
    // @ts-expect-error Tag.labels is a list of text values, not one
    plain.Tag.apply(labelled);
    const titles = client.scope({ title: field.column(textColumn).many() }, (rows) =>
      rows.limit(1),
    );
    // @ts-expect-error Post.title holds one text value, not a list
    plain.Post.apply(titles);
    const titlesDeclared = client.scope(
      { title: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: false } } },
      (rows) => rows.limit(1),
    );
    // @ts-expect-error Post.title holds one text value, not a list
    plain.Post.apply(titlesDeclared);
  });

  test('.many() matches a list whose elements are never null, and not one whose elements may be null', () => {
    const labels = client.scope({ labels: field.column(textColumn).many() }, (rows) =>
      rows.limit(1),
    );
    expectTypeOf(plain.Tag.apply(labels)).toEqualTypeOf<typeof plain.Tag>();
    const notes = client.scope({ notes: field.column(textColumn).many() }, (rows) => rows.limit(1));
    // @ts-expect-error the elements of Tag.notes may be null
    plain.Tag.apply(notes);
  });

  test('.many({ elementsNullable: true }) matches a list whose elements may be null, and not one whose elements are never null', () => {
    const notes = client.scope(
      { notes: field.column(textColumn).many({ elementsNullable: true }) },
      (rows) => rows.limit(1),
    );
    expectTypeOf(plain.Tag.apply(notes)).toEqualTypeOf<typeof plain.Tag>();
    const labels = client.scope(
      { labels: field.column(textColumn).many({ elementsNullable: true }) },
      (rows) => rows.limit(1),
    );
    // @ts-expect-error the elements of Tag.labels are never null
    plain.Tag.apply(labels);
  });

  test('the package form declares a list with many: { elementNullable }', () => {
    const labels = client.scope(
      { labels: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: false } } },
      (rows) => rows.limit(1),
    );
    plain.Tag.apply(labels);
    const notesAsStrict = client.scope(
      { notes: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: false } } },
      (rows) => rows.limit(1),
    );
    // @ts-expect-error the elements of Tag.notes may be null
    plain.Tag.apply(notesAsStrict);
    const notes = client.scope(
      { notes: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: true } } },
      (rows) => rows.limit(1),
    );
    plain.Tag.apply(notes);
    const labelsAsNullable = client.scope(
      { labels: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: true } } },
      (rows) => rows.limit(1),
    );
    // @ts-expect-error the elements of Tag.labels are never null
    plain.Tag.apply(labelsAsNullable);
    client.scope(
      // @ts-expect-error many: true is not a declaration; a list declares its element nullability
      { labels: { codecId: 'pg/text@1', nullable: false, many: true } },
      (rows) => rows.limit(1),
    );
  });

  test('a list of value objects, stored as one jsonb value, matches a list declaration only', () => {
    const asList = client.scope({ addresses: field.column(jsonbColumn).many() }, (rows) =>
      rows.limit(1),
    );
    expectTypeOf(plain.Tag.apply(asList)).toEqualTypeOf<typeof plain.Tag>();
    const asDeclaredList = client.scope(
      { addresses: { codecId: 'pg/jsonb@1', nullable: false, many: { elementNullable: false } } },
      (rows) => rows.limit(1),
    );
    expectTypeOf(plain.Tag.apply(asDeclaredList)).toEqualTypeOf<typeof plain.Tag>();
    const asOneValue = client.scope({ addresses: field.column(jsonbColumn) }, (rows) =>
      rows.limit(1),
    );
    // @ts-expect-error Tag.addresses is a list of value objects, not one value
    plain.Tag.apply(asOneValue);
  });

  test('the refusal compares the element nullability of a list', () => {
    type Strict = { readonly elementNullable: false };
    type NullableElements = { readonly elementNullable: true };
    expectTypeOf<
      MissingScopeFields<
        Contract,
        'Tag',
        'public',
        { readonly labels: DeclaredField<'pg/text@1', false> }
      >
    >().toEqualTypeOf<'labels'>();
    expectTypeOf<
      MissingScopeFields<
        Contract,
        'Tag',
        'public',
        { readonly labels: DeclaredField<'pg/text@1', false, Strict> }
      >
    >().toBeNever();
    expectTypeOf<
      MissingScopeFields<
        Contract,
        'Tag',
        'public',
        { readonly labels: DeclaredField<'pg/text@1', false, NullableElements> }
      >
    >().toEqualTypeOf<'labels'>();
    expectTypeOf<
      MissingScopeFields<
        Contract,
        'Tag',
        'public',
        { readonly notes: DeclaredField<'pg/text@1', false, NullableElements> }
      >
    >().toBeNever();
    expectTypeOf<
      MissingScopeFields<
        Contract,
        'Tag',
        'public',
        { readonly notes: DeclaredField<'pg/text@1', false, Strict> }
      >
    >().toEqualTypeOf<'notes'>();
  });

  test('the body sees a list field whose elements include null only when the declaration says they may be null', () => {
    type TagAccessor = ModelAccessor<Contract, 'Tag', 'public'>;
    client.scope({ labels: field.column(textColumn).many() }, (rows) =>
      rows.where((r) => {
        expectTypeOf(r.labels).toEqualTypeOf<CodecListField<Contract, 'pg/text@1'>>();
        expectTypeOf(r.labels.eq)
          .parameter(0)
          .toEqualTypeOf<Parameters<TagAccessor['labels']['eq']>[0]>();
        // @ts-expect-error the declaration says the elements of labels are never null
        r.labels.eq(['a', null]);
        return r.labels.eq(['a']);
      }),
    );
    client.scope({ notes: field.column(textColumn).many({ elementsNullable: true }) }, (rows) =>
      rows.where((r) => {
        expectTypeOf(r.notes).toEqualTypeOf<CodecListField<Contract, 'pg/text@1', false, true>>();
        expectTypeOf(r.notes.eq)
          .parameter(0)
          .toEqualTypeOf<Parameters<TagAccessor['notes']['eq']>[0]>();
        return r.notes.eq(['a', null]);
      }),
    );
    client.scope(
      { notes: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: true } } },
      (rows) =>
        rows.where((r) => {
          expectTypeOf(r.notes).toEqualTypeOf<CodecListField<Contract, 'pg/text@1', false, true>>();
          return r.notes.eq(['a', null]);
        }),
    );
  });

  test('a union of collections is accepted when every model in it has the fields', () => {
    const either = flag ? plain.Post : plain.Comment;
    expectTypeOf(either.apply(notDeleted)).toEqualTypeOf<Filtered<typeof either>>();
    const postOrTag = flag ? plain.Post : plain.Tag;
    // @ts-expect-error Tag, one of the models in the union, has no deletedAt
    postOrTag.apply(notDeleted);
  });
});
