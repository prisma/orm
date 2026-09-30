import { createMongoAdapter } from '@internal/adapter-mongo';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import type { AnyMongoCommand } from '@internal/mongo-query-ast/execution';
import {
  AggregateCommand,
  DeleteManyCommand,
  InsertManyCommand,
  InsertOneCommand,
  MongoFieldFilter,
  MongoMatchStage,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import { flattenMongoParamRefs } from '@internal/mongo-runtime';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';

const stubMeta = { target: 'mongo', storageHash: 'test-hash', lane: 'mongo-orm' };

function plan(collection: string, command: AnyMongoCommand) {
  return { collection, command, meta: stubMeta };
}

/**
 * Mirrors {@link resolveDraftSlot} in `adapter-mongo/resolve-value.ts` — collects
 * every `MongoParamRef` the resolve walk would visit (without invoking codecs).
 */
function collectRefsResolveWalk(value: unknown): MongoParamRef[] {
  if (value instanceof MongoParamRef) {
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

function collectRefsFromDraft(draft: MongoLoweredDraft): MongoParamRef[] {
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
  const fromFlatten = [...flattenMongoParamRefs(draft)];
  const fromResolveWalk = collectRefsFromDraft(draft);
  expect(fromFlatten).toEqual(fromResolveWalk);
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
});
