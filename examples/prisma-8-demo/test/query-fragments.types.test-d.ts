import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import {
  type CodecField,
  type CollectionRowOf,
  type ModelAccessor,
  orderByField,
} from '@prisma/orm-postgres/orm-client';
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';
import { describe, expectTypeOf, test } from 'vitest';
import { createOrmClient } from '../src/orm-client/client';
import { createdSince, postSummary } from '../src/orm-client/fragments';
import type { ormClientGetRecentPosts } from '../src/orm-client/get-recent-posts';
import type { ormClientGetRecentUsers } from '../src/orm-client/get-recent-users';
import type { Contract } from '../src/prisma/contract.d';

declare const runtime: Runtime;
declare const since: Temporal.Instant;
declare const orderBy: string;

const db = createOrmClient(runtime);

type TimestampCodec = 'pg/timestamptz-temporal@1';
type CreatedAt = CodecField<Contract, TimestampCodec>;
type Title = CodecField<Contract, 'pg/text@1'>;
type PostAccessor = ModelAccessor<Contract, 'Post', 'public'>;
type PostSummary = CollectionRowOf<ReturnType<typeof postSummary>>;

describe('CodecField', () => {
  test('a timestamp field and its CodecField are assignable both ways', () => {
    expectTypeOf<PostAccessor['createdAt']>().toExtend<CreatedAt>();
    expectTypeOf<CreatedAt>().toExtend<PostAccessor['createdAt']>();
    expectTypeOf<Temporal.Instant>().toExtend<Parameters<CreatedAt['gte']>[0]>();
    expectTypeOf<string>().not.toExtend<Parameters<CreatedAt['gte']>[0]>();
  });

  test('a text field with full-text operations and its CodecField are assignable both ways', () => {
    expectTypeOf<PostAccessor['title']>().toExtend<Title>();
    expectTypeOf<Title>().toExtend<PostAccessor['title']>();
    const matches = (row: { title: Title }) => row.title.fullTextMatches(websearchToTsquery('orm'));
    db.Post.where(matches);
  });

  test('a fragment checks values against the codec, not the enum of the field', () => {
    const kindIs = (row: { kind: CodecField<Contract, 'pg/text@1'> }) => row.kind.eq('superuser');
    db.User.where(kindIs);
    // @ts-expect-error the field's own type is the user_type enum, which has no superuser
    db.User.where((user) => user.kind.eq('superuser'));
  });

  test('a row fragment fits every model with the field and no other', () => {
    db.User.where(createdSince(since));
    db.Post.where(createdSince(since));
    db.Task.where(createdSince(since));
    db.Task.bugs().where(createdSince(since));
    // @ts-expect-error Tag has no createdAt
    db.Tag.where(createdSince(since));
  });
});

describe('modelStep', () => {
  test('names the row of the summary', () => {
    expectTypeOf<PostSummary>().toEqualTypeOf<{
      id: string;
      title: string;
      createdAt: Temporal.Instant;
      tags: { id: string; label: string }[];
    }>();
  });

  test('is refused after select and for another model', () => {
    // @ts-expect-error the rows no longer have every Post field
    db.Post.select('id').apply(postSummary);
    // @ts-expect-error a Tag collection is not a Post collection
    db.Tag.apply(postSummary);
  });
});

describe('orderByField', () => {
  test('the allowed list takes only fields that can be ordered', () => {
    db.Post.orderBy(orderByField(db.Post, orderBy, 'asc', ['title', 'createdAt']));
    // @ts-expect-error the codec of embedding has no order trait
    orderByField(db.Post, orderBy, 'asc', ['embedding']);
    // @ts-expect-error user is a relation
    orderByField(db.Post, orderBy, 'asc', ['user']);
  });
});

describe('the demo queries', () => {
  test('return post summaries', async () => {
    expectTypeOf<Awaited<ReturnType<typeof ormClientGetRecentPosts>>>().toEqualTypeOf<
      PostSummary[]
    >();
    type RecentUser = Awaited<ReturnType<typeof ormClientGetRecentUsers>>[number];
    expectTypeOf<RecentUser['posts']>().toEqualTypeOf<PostSummary[]>();
    expectTypeOf<RecentUser['email']>().toEqualTypeOf<string>();
  });
});
