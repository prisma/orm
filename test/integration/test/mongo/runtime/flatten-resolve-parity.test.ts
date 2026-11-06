import { createMongoAdapter } from '@internal/adapter-mongo';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import type { AnyMongoCommand } from '@internal/mongo-query-ast/execution';
import {
  AggregateCommand,
  DeleteManyCommand,
  InsertManyCommand,
  InsertOneCommand,
  MongoFieldFilter,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import { flattenMongoDraftLeaves, flattenMongoParamRefs } from '@internal/mongo-runtime';
import { MongoParamRef, MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';

const stubMeta = { target: 'mongo', storageHash: 'test-hash', lane: 'mongo-orm' };

function plan(collection: string, command: AnyMongoCommand) {
  return { collection, command, meta: stubMeta };
}

type DraftLeaf = MongoParamRef | MongoPreparedParamRef;

/**
 * Mirrors {@link resolveDraftSlot} in `adapter-mongo/resolve-value.ts` — collects
 * every `MongoParamRef` and placeholder the resolve walk would visit (without invoking codecs).
 */
function collectRefsResolveWalk(value: unknown): DraftLeaf[] {
  if (value instanceof MongoParamRef || value instanceof MongoPreparedParamRef) {
    return [value];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  if (value instanceof Date) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectRefsResolveWalk(item));
  }
  return Object.values(value).flatMap((v) => collectRefsResolveWalk(v));
}

function collectRefsFromDraft(draft: MongoLoweredDraft): DraftLeaf[] {
  switch (draft.kind) {
    case 'insertOne':
    case 'rawInsertOne':
      return collectRefsResolveWalk(draft.document);
    case 'insertMany':
    case 'rawInsertMany':
      return draft.documents.flatMap((doc) => collectRefsResolveWalk(doc));
    case 'updateOne':
    case 'updateMany':
    case 'rawUpdateOne':
    case 'rawUpdateMany':
    case 'findOneAndUpdate':
    case 'rawFindOneAndUpdate':
      return [...collectRefsResolveWalk(draft.filter), ...collectRefsResolveWalk(draft.update)];
    case 'deleteOne':
    case 'deleteMany':
    case 'rawDeleteOne':
    case 'rawDeleteMany':
    case 'findOneAndDelete':
    case 'rawFindOneAndDelete':
      return collectRefsResolveWalk(draft.filter);
    case 'aggregate':
    case 'rawAggregate':
      return draft.pipeline.flatMap((stage) => collectRefsResolveWalk(stage));
  }
}

function expectFlattenMatchesResolve(draft: MongoLoweredDraft): void {
  const fromResolveWalk = collectRefsFromDraft(draft);
  expect([...flattenMongoDraftLeaves(draft)]).toEqual(fromResolveWalk);
  expect([...flattenMongoParamRefs(draft)]).toEqual(
    fromResolveWalk.filter((leaf) => leaf instanceof MongoParamRef),
  );
}

describe('flattenMongoParamRefs / resolveParams walk parity', () => {
  const adapter = createMongoAdapter();

  it('matches resolve traversal for insertOne with nested refs', () => {
    const draft = adapter.structuralLower(
      plan(
        'users',
        new InsertOneCommand('users', {
          name: new MongoParamRef('Alice'),
          meta: { nested: new MongoParamRef('tag') },
          createdAt: new Date('2020-01-01'),
        }),
      ),
    );
    expectFlattenMatchesResolve(draft);
  });

  it('matches resolve traversal for insertMany', () => {
    const draft = adapter.structuralLower(
      plan(
        'users',
        new InsertManyCommand('users', [
          { name: new MongoParamRef('a') },
          { name: new MongoParamRef('b') },
        ]),
      ),
    );
    expectFlattenMatchesResolve(draft);
  });

  it('matches resolve traversal for updateOne filter and document update', () => {
    const draft = adapter.structuralLower(
      plan(
        'users',
        new UpdateOneCommand('users', MongoFieldFilter.eq('_id', new MongoParamRef('id')), {
          $set: { role: new MongoParamRef('admin') },
        }),
      ),
    );
    expectFlattenMatchesResolve(draft);
  });

  it('matches resolve traversal for updateMany filter and update', () => {
    const draft = adapter.structuralLower(
      plan(
        'users',
        new UpdateManyCommand('users', MongoFieldFilter.eq('status', new MongoParamRef('active')), {
          $set: { score: new MongoParamRef(1) },
        }),
      ),
    );
    expectFlattenMatchesResolve(draft);
  });

  it('matches resolve traversal for deleteMany filter', () => {
    const draft = adapter.structuralLower(
      plan(
        'users',
        new DeleteManyCommand('users', MongoFieldFilter.eq('status', new MongoParamRef('gone'))),
      ),
    );
    expectFlattenMatchesResolve(draft);
  });

  it('matches resolve traversal for aggregate pipeline stages', () => {
    const matchRef = new MongoParamRef(10);
    const draft = adapter.structuralLower(
      plan(
        'orders',
        new AggregateCommand('orders', [
          new MongoMatchStage(MongoFieldFilter.gt('amount', matchRef)),
        ]),
      ),
    );
    expectFlattenMatchesResolve(draft);
  });

  it('matches resolve traversal for placeholders in a filter and a sub-pipeline $limit', () => {
    const email = new MongoPreparedParamRef('email', 'mongo/string@1', false);
    const take = new MongoPreparedParamRef('take', 'mongo/int32@1', false);
    const draft = adapter.structuralLower(
      plan(
        'users',
        new AggregateCommand('users', [
          new MongoMatchStage(MongoFieldFilter.eq('email', email)),
          new MongoLookupStage({
            from: 'posts',
            as: 'posts',
            pipeline: [new MongoLimitStage(take)],
          }),
          new MongoLimitStage(take),
        ]),
      ),
    );
    expect([...flattenMongoDraftLeaves(draft)]).toEqual([email, take, take]);
    expectFlattenMatchesResolve(draft);
  });
});
