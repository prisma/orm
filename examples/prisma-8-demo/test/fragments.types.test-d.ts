import { field } from '@prisma/orm-postgres/contract-builder';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import {
  type CodecField,
  type CollectionRowOf,
  type Filtered,
  type ModelAccessor,
  orderByField,
} from '@prisma/orm-postgres/orm-client';
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';
import { describe, expectTypeOf, test } from 'vitest';
import { createOrmClient } from '../src/orm-client/client';
import { createdSince, ownedBy, postSummary } from '../src/orm-client/fragments';
import type { ormClientGetRecentPosts } from '../src/orm-client/get-recent-posts';
import type { ormClientGetRecentUsers } from '../src/orm-client/get-recent-users';
import type { Contract } from '../src/prisma/contract.d';
import { db as dbFacade } from '../src/prisma/db';

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
    const created = (row: { createdAt: CreatedAt }) => row.createdAt.gte(since);
    db.User.where(created);
    db.Post.where(created);
    db.Task.where(created);
    db.Task.bugs().where(created);
    // @ts-expect-error Tag has no createdAt
    db.Tag.where(created);
  });
});

describe('db.orm.fragment', () => {
  test('fits every model with the field, keeps its class and records the filter', () => {
    expectTypeOf(db.User.with(createdSince(since))).toEqualTypeOf<Filtered<typeof db.User>>();
    expectTypeOf(db.Post.with(createdSince(since))).toEqualTypeOf<Filtered<typeof db.Post>>();
    db.Task.with(createdSince(since)).bugs();
    db.Task.bugs().with(createdSince(since));
    db.Post.with(createdSince(since)).updateAll({ title: 'x' });
  });

  test('is refused for a model without the field', () => {
    // @ts-expect-error Tag has no createdAt
    db.Tag.with(createdSince(since));
  });

  test('takes the preset field builders exported by the contract-builder entry', () => {
    expectTypeOf(db.Post.with(ownedBy('u'))).toEqualTypeOf<Filtered<typeof db.Post>>();
    db.Task.with(ownedBy('u'));
    // @ts-expect-error User has no userId
    db.User.with(ownedBy('u'));
    const titled = dbFacade.orm.fragment({ title: field.text() }, (rows) =>
      rows.where((r) => r.title.eq('x')),
    );
    db.Post.with(titled);
    const nullableTitle = dbFacade.orm.fragment({ title: field.text().optional() }, (rows) =>
      rows.limit(1),
    );
    // @ts-expect-error Post.title is not nullable
    db.Post.with(nullableTitle);
  });
});

describe('db.orm.public.Post.fragment', () => {
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
    db.Post.select('id').with(postSummary);
    // @ts-expect-error a Tag collection is not a Post collection
    db.Tag.with(postSummary);
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
