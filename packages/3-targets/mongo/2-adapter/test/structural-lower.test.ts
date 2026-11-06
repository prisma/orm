import type { AnyMongoCommand } from '@internal/mongo-query-ast/execution';
import {
  AggregateCommand,
  DeleteManyCommand,
  DeleteOneCommand,
  FindOneAndDeleteCommand,
  FindOneAndUpdateCommand,
  InsertManyCommand,
  InsertOneCommand,
  MongoAddFieldsStage,
  MongoAggFieldRef,
  MongoAndExpr,
  MongoFieldFilter,
  MongoMatchStage,
  RawAggregateCommand,
  RawInsertOneCommand,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { createMongoAdapter } from '../src/mongo-adapter';

const stubMeta = { target: 'mongo', storageHash: 'test-hash', lane: 'mongo-orm' };

function plan(collection: string, command: AnyMongoCommand) {
  return { collection, command, meta: stubMeta };
}

describe('MongoAdapter.structuralLower', () => {
  const adapter = createMongoAdapter();

  describe('insertOne — document retains MongoParamRef leaves', () => {
    it('keeps MongoParamRef nodes in document fields', () => {
      const ref = new MongoParamRef('Alice');
      const command = new InsertOneCommand('users', {
        name: ref,
        role: new MongoParamRef('admin'),
      });
      const draft = adapter.structuralLower(plan('users', command));
      expect(draft.kind).toBe('insertOne');
      if (draft.kind === 'insertOne') {
        expect(draft.document['name']).toBe(ref);
        expect(draft.document['name']).toBeInstanceOf(MongoParamRef);
        expect(draft.document['role']).toBeInstanceOf(MongoParamRef);
      }
    });

    it('does not resolve MongoParamRef — value remains the original ref instance', () => {
      const ref = new MongoParamRef(42);
      const command = new InsertOneCommand('orders', { count: ref });
      const draft = adapter.structuralLower(plan('orders', command));
      if (draft.kind === 'insertOne') {
        expect(draft.document['count']).toBe(ref);
      }
    });
  });

  describe('field filter — MongoParamRef leaf preserved', () => {
    it('$eq filter carries MongoParamRef at leaf value position', () => {
      const ref = new MongoParamRef('id-123');
      const command = new DeleteOneCommand('users', MongoFieldFilter.eq('_id', ref));
      const draft = adapter.structuralLower(plan('users', command));
      expect(draft.kind).toBe('deleteOne');
      if (draft.kind === 'deleteOne') {
        const idField = draft.filter['_id'] as Record<string, unknown>;
        expect(idField['$eq']).toBe(ref);
        expect(idField['$eq']).toBeInstanceOf(MongoParamRef);
      }
    });

    it('$and filter carries MongoParamRef in nested field filter', () => {
      const ref1 = new MongoParamRef('active');
      const ref2 = new MongoParamRef('admin');
      const command = new DeleteManyCommand(
        'users',
        MongoAndExpr.of([MongoFieldFilter.eq('status', ref1), MongoFieldFilter.eq('role', ref2)]),
      );
      const draft = adapter.structuralLower(plan('users', command));
      if (draft.kind === 'deleteMany') {
        const andArr = draft.filter['$and'] as Array<Record<string, unknown>>;
        expect(andArr).toHaveLength(2);
        const statusField = andArr[0]?.['status'] as Record<string, unknown>;
        expect(statusField?.['$eq']).toBe(ref1);
        const roleField = andArr[1]?.['role'] as Record<string, unknown>;
        expect(roleField?.['$eq']).toBe(ref2);
      }
    });
  });

  describe('aggregate pipeline — $match filter retains MongoParamRef', () => {
    it('$match stage keeps MongoParamRef at filter leaf', () => {
      const ref = new MongoParamRef('active');
      const command = new AggregateCommand('users', [
        new MongoMatchStage(MongoFieldFilter.eq('status', ref)),
      ]);
      const draft = adapter.structuralLower(plan('users', command));
      expect(draft.kind).toBe('aggregate');
      if (draft.kind === 'aggregate') {
        const matchStage = draft.pipeline[0] as Record<string, unknown>;
        const matchDoc = matchStage['$match'] as Record<string, unknown>;
        const statusField = matchDoc['status'] as Record<string, unknown>;
        expect(statusField['$eq']).toBe(ref);
        expect(statusField['$eq']).toBeInstanceOf(MongoParamRef);
      }
    });

    it('non-filter pipeline stages (addFields) produce no MongoParamRef', () => {
      const command = new AggregateCommand('users', [
        new MongoAddFieldsStage({ fullName: MongoAggFieldRef.of('name') }),
      ]);
      const draft = adapter.structuralLower(plan('users', command));
      if (draft.kind === 'aggregate') {
        const addFieldsStage = draft.pipeline[0] as Record<string, unknown>;
        expect(addFieldsStage['$addFields']).toBeDefined();
        const addFieldsDoc = addFieldsStage['$addFields'] as Record<string, unknown>;
        expect(addFieldsDoc['fullName']).toBe('$name');
      }
    });
  });

  describe('updateOne — filter and update doc retain MongoParamRef', () => {
    it('filter carries MongoParamRef at leaf position', () => {
      const filterId = new MongoParamRef('user-1');
      const command = new UpdateOneCommand('users', MongoFieldFilter.eq('_id', filterId), {
        $set: { name: new MongoParamRef('NewName') },
      });
      const draft = adapter.structuralLower(plan('users', command));
      if (draft.kind === 'updateOne') {
        const idField = draft.filter['_id'] as Record<string, unknown>;
        expect(idField['$eq']).toBe(filterId);
      }
    });

    it('update document carries MongoParamRef values', () => {
      const nameRef = new MongoParamRef('NewName');
      const command = new UpdateOneCommand(
        'users',
        MongoFieldFilter.eq('_id', new MongoParamRef('user-1')),
        { $set: { name: nameRef } },
      );
      const draft = adapter.structuralLower(plan('users', command));
      if (draft.kind === 'updateOne') {
        const update = draft.update as Record<string, unknown>;
        const setDoc = update['$set'] as Record<string, unknown>;
        expect(setDoc['name']).toBe(nameRef);
        expect(setDoc['name']).toBeInstanceOf(MongoParamRef);
      }
    });
  });

  describe('insertMany — documents retain MongoParamRef', () => {
    it('each document keeps its MongoParamRef nodes', () => {
      const ref1 = new MongoParamRef('Alice');
      const ref2 = new MongoParamRef('Bob');
      const command = new InsertManyCommand('users', [{ name: ref1 }, { name: ref2 }]);
      const draft = adapter.structuralLower(plan('users', command));
      if (draft.kind === 'insertMany') {
        expect(draft.documents[0]?.['name']).toBe(ref1);
        expect(draft.documents[1]?.['name']).toBe(ref2);
      }
    });
  });

  describe('raw commands — pass through unchanged (no MongoParamRef resolution)', () => {
    it('rawInsertOne pipeline passes document unchanged', () => {
      const doc = { name: 'Alice', email: 'alice@example.com' };
      const command = new RawInsertOneCommand('users', doc);
      const draft = adapter.structuralLower(plan('users', command));
      expect(draft.kind).toBe('rawInsertOne');
      if (draft.kind === 'rawInsertOne') {
        expect(draft.document).toBe(doc);
      }
    });

    it('rawAggregate passes pipeline unchanged', () => {
      const pipeline = [{ $match: { status: 'active' } }];
      const command = new RawAggregateCommand('users', pipeline);
      const draft = adapter.structuralLower(plan('users', command));
      expect(draft.kind).toBe('rawAggregate');
      if (draft.kind === 'rawAggregate') {
        expect(draft.pipeline).toBe(pipeline);
      }
    });
  });

  describe('findOneAndUpdate — filter retains MongoParamRef', () => {
    it('filter carries MongoParamRef at leaf', () => {
      const filterId = new MongoParamRef('id-foo');
      const command = new FindOneAndUpdateCommand(
        'users',
        MongoFieldFilter.eq('_id', filterId),
        { $set: { name: new MongoParamRef('Updated') } },
        false,
      );
      const draft = adapter.structuralLower(plan('users', command));
      if (draft.kind === 'findOneAndUpdate') {
        const idField = draft.filter['_id'] as Record<string, unknown>;
        expect(idField['$eq']).toBe(filterId);
      }
    });
  });

  describe('findOneAndDelete — filter retains MongoParamRef', () => {
    it('filter carries MongoParamRef at leaf', () => {
      const filterId = new MongoParamRef('id-bar');
      const command = new FindOneAndDeleteCommand('users', MongoFieldFilter.eq('_id', filterId));
      const draft = adapter.structuralLower(plan('users', command));
      if (draft.kind === 'findOneAndDelete') {
        const idField = draft.filter['_id'] as Record<string, unknown>;
        expect(idField['$eq']).toBe(filterId);
      }
    });
  });

  describe('updateMany — filter retains MongoParamRef', () => {
    it('filter carries MongoParamRef at leaf', () => {
      const statusRef = new MongoParamRef('inactive');
      const command = new UpdateManyCommand('users', MongoFieldFilter.eq('status', statusRef), {
        $set: { archived: true },
      });
      const draft = adapter.structuralLower(plan('users', command));
      if (draft.kind === 'updateMany') {
        const statusField = draft.filter['status'] as Record<string, unknown>;
        expect(statusField['$eq']).toBe(statusRef);
      }
    });
  });
});

describe('MongoAdapter.lower is composition of structuralLower + resolveParams', () => {
  const adapter = createMongoAdapter();

  it('lower produces the same wire output as resolveParams(structuralLower(plan))', async () => {
    const command = new InsertOneCommand('users', {
      name: new MongoParamRef('Alice'),
      age: new MongoParamRef(30),
    });
    const p = plan('users', command);
    const viaLower = await adapter.lower(p, {});
    const viaTwoPhase = await adapter.resolveParams(adapter.structuralLower(p), {});
    expect(viaLower).toEqual(viaTwoPhase);
  });
});
