import type { AnyExpression, OrderByItem } from '@internal/sql-relational-core/ast';
import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { and } from '../src/filters';
import type { CodecField, ModelAccessor } from '../src/types';
import { createChainingOrm } from './collection-chaining-fixture';
import type { TestContract } from './helpers';
import { createScopesOrm, type SoftDeleteContract } from './scopes-fixture';

type Contract = SoftDeleteContract;
type TimestampCodec = 'pg/timestamptz-temporal@1';
type DeletedAt = CodecField<Contract, TimestampCodec, true>;
type Title = CodecField<Contract, 'pg/text@1'>;

const notDeleted = (row: { deletedAt: DeletedAt }) => row.deletedAt.isNull();
const newestDeletedFirst = (row: { deletedAt: DeletedAt }) => row.deletedAt.desc();

const { db } = createScopesOrm();

type PostAccessor = ModelAccessor<Contract, 'Post', 'public'>;
type CommentAccessor = ModelAccessor<Contract, 'Comment', 'public'>;

class LivePostCollection extends Collection<Contract, 'Post'> {
  live() {
    return this.where(notDeleted);
  }
}

describe('CodecField is the field type of the model accessor', () => {
  test('it resolves to a typed expression, not any', () => {
    expectTypeOf<DeletedAt>().not.toBeAny();
    expectTypeOf<DeletedAt['isNull']>().returns.toEqualTypeOf<AnyExpression>();
    expectTypeOf<Parameters<Title['eq']>[0]>().not.toBeAny();
  });

  test('a nullable field and its CodecField are assignable both ways', () => {
    expectTypeOf<PostAccessor['deletedAt']>().toExtend<DeletedAt>();
    expectTypeOf<DeletedAt>().toExtend<PostAccessor['deletedAt']>();
    expectTypeOf<CommentAccessor['deletedAt']>().toExtend<DeletedAt>();
    expectTypeOf<DeletedAt>().toExtend<CommentAccessor['deletedAt']>();
  });

  test('a field with package operations and its CodecField are assignable both ways', () => {
    expectTypeOf<Title>().toHaveProperty('fullTextMatches');
    expectTypeOf<PostAccessor['title']>().toExtend<Title>();
    expectTypeOf<Title>().toExtend<PostAccessor['title']>();
  });

  test('the comparison methods follow the codec traits', () => {
    expectTypeOf<DeletedAt>().toHaveProperty('gt');
    expectTypeOf<DeletedAt>().not.toHaveProperty('like');
    expectTypeOf<Title>().toHaveProperty('like');
  });

  test('another nullability or another codec is a different type', () => {
    expectTypeOf<CodecField<Contract, TimestampCodec>>().not.toExtend<DeletedAt>();
    expectTypeOf<DeletedAt>().not.toExtend<CodecField<Contract, TimestampCodec>>();
    expectTypeOf<CodecField<Contract, 'pg/int4@1'>>().not.toExtend<Title>();
  });
});

describe('a row fragment typed with CodecField', () => {
  test('filters every model that has the field', () => {
    expectTypeOf(db.Post.where(notDeleted)).not.toBeAny();
    db.Post.where(notDeleted);
    db.Comment.where(notDeleted);
    db.Comment.where((c) => and(notDeleted(c), c.postId.eq(1)));
  });

  test('orders by the field', () => {
    expectTypeOf(newestDeletedFirst).returns.toEqualTypeOf<OrderByItem>();
    db.Post.orderBy(newestDeletedFirst);
    db.Comment.orderBy([newestDeletedFirst, (c) => c.id.asc()]);
  });

  test('fits a chained collection, a custom class, an include refinement and this', () => {
    db.Post.where({ title: 'x' }).where(notDeleted);
    db.Post.popular().where(notDeleted).popular();
    db.User.include('posts', (posts) => posts.where(notDeleted));
    db.Post.include('comments', (comments) =>
      comments.where(notDeleted).orderBy(newestDeletedFirst),
    );
    expectTypeOf<ReturnType<LivePostCollection['live']>>().not.toBeAny();
  });

  test('calls a package operation', () => {
    const matches = (row: { title: Title }) => row.title.fullTextMatches(websearchToTsquery('orm'));
    db.Post.where(matches);
  });

  test('is refused for a model without the field', () => {
    // @ts-expect-error Tag has no deletedAt
    db.Tag.where(notDeleted);
    // @ts-expect-error User has no deletedAt
    db.Post.include('user', (user) => user.where(notDeleted));
  });

  test('names a codec of the contract', () => {
    // @ts-expect-error the contract has no codec pg/timestamptz@1
    expectTypeOf<CodecField<Contract, 'pg/timestamptz@1'>>().not.toBeAny();
  });

  test('is refused for a field of another codec', () => {
    const titleIsSeven = (row: { title: CodecField<Contract, 'pg/int4@1'> }) => row.title.eq(7);
    // @ts-expect-error title is text, not int4
    db.Post.where(titleIsSeven);
  });

  test('is refused for a field of another nullability', () => {
    const notDeletedNonNull = (row: { deletedAt: CodecField<Contract, TimestampCodec> }) =>
      row.deletedAt.isNull();
    // @ts-expect-error deletedAt is nullable
    db.Post.where(notDeletedNonNull);
    const createdIsNull = (row: { createdAt: DeletedAt }) => row.createdAt.isNull();
    // @ts-expect-error createdAt is not nullable
    db.Post.where(createdIsNull);
  });
});

describe('a CodecField fragment checks values against the codec, not the field', () => {
  const { plain } = createChainingOrm();

  test('it accepts a value of the codec that the field refines away', () => {
    const tagIs = (row: { tagId: CodecField<TestContract, 'sql/char@1'> }) =>
      row.tagId.eq('plain-string');
    plain.UserTag.where(tagIs);
    // @ts-expect-error the field's own type is Char<36>, and a plain string is not one
    plain.UserTag.where((row) => row.tagId.eq('plain-string'));
  });
});
