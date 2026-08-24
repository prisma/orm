import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import {
  MongoFieldFilter,
  type MongoLimitStage,
  type MongoLookupStage,
  type MongoMatchStage,
  type MongoPipelineStage,
  type MongoProjectStage,
  type MongoSkipStage,
  type MongoSortStage,
} from '@internal/mongo-query-ast/execution';
import type { MongoValue } from '@internal/mongo-value';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import type {
  CodecTypes,
  Contract,
} from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';
import {
  compileFieldOperations,
  createFieldAccessor,
  type FieldAccessor,
  type FieldExpression,
  type FieldOperation,
} from '../src/field-accessor';

const contract = ormContractJson as unknown as Contract;

const defaultUserData = {
  name: 'Alice',
  email: 'a@b.c',
  loginCount: 0,
  tags: [] as string[],
  homeAddress: null,
};

function createMockExecutor(
  ...responses: Array<unknown[] | { affectedRows: number }>
): MongoQueryExecutor & {
  lastPlan: MongoQueryPlan | undefined;
  lastOperation: 'query' | 'execute' | undefined;
  readonly lastCommand: MongoQueryPlan['command'] | undefined;
  readonly lastStages: ReadonlyArray<MongoPipelineStage> | undefined;
} {
  let callIndex = 0;
  const mock = {
    lastPlan: undefined as MongoQueryPlan | undefined,
    lastOperation: undefined as 'query' | 'execute' | undefined,
    get lastCommand() {
      return mock.lastPlan?.command;
    },
    get lastStages(): ReadonlyArray<MongoPipelineStage> | undefined {
      const cmd = mock.lastPlan?.command;
      if (cmd?.kind === 'aggregate') return cmd.pipeline as ReadonlyArray<MongoPipelineStage>;
      return undefined;
    },
    query<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      mock.lastPlan = plan as MongoQueryPlan;
      mock.lastOperation = 'query';
      const data = responses[callIndex] ?? [];
      callIndex++;
      if (!Array.isArray(data)) throw new Error('expected row response');
      const rows = data;
      async function* gen(): AsyncGenerator<Row> {
        for (const row of rows) yield row as Row;
      }
      return new AsyncIterableResult(gen());
    },
    async execute(plan: MongoQueryPlan): Promise<{ affectedRows: number }> {
      mock.lastPlan = plan;
      mock.lastOperation = 'execute';
      const data = responses[callIndex] ?? { affectedRows: 0 };
      callIndex++;
      if (Array.isArray(data)) throw new Error('expected statistics response');
      return data;
    },
  };
  return mock;
}

describe('MongoCollection chaining', () => {
  it('returns a new instance from where()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const filtered = col.where(MongoFieldFilter.eq('name', 'Alice'));
    expect(filtered).not.toBe(col);
  });

  it('accumulates filters from multiple where() calls', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor)
      .where(MongoFieldFilter.eq('name', 'Alice'))
      .where(MongoFieldFilter.gte('email', 'a'));
    col.all();
    const match = executor.lastStages![0] as MongoMatchStage;
    expect(match.filter.kind).toBe('and');
  });

  it('returns a new instance from select()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const selected = col.select('name');
    expect(selected).not.toBe(col);
    selected.all();
    expect(executor.lastStages!.some((s) => s.kind === 'project')).toBe(true);
  });

  it('accumulates fields across multiple select() calls', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor).select('name').select('_id');
    col.all();
    const project = executor.lastStages!.find((s) => s.kind === 'project') as MongoProjectStage;
    expect(project.projection).toEqual({ name: 1, _id: 1 });
  });

  it('returns a new instance from orderBy()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const ordered = col.orderBy({ name: 1 });
    expect(ordered).not.toBe(col);
    ordered.all();
    const sort = executor.lastStages!.find((s) => s.kind === 'sort') as MongoSortStage;
    expect(sort.sort).toEqual({ name: 1 });
  });

  it('merges orderBy across calls', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor)
      .orderBy({ name: 1 })
      .orderBy({ email: -1 });
    col.all();
    const sort = executor.lastStages!.find((s) => s.kind === 'sort') as MongoSortStage;
    expect(sort.sort).toEqual({ name: 1, email: -1 });
  });

  it('returns a new instance from limit()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const limited = col.limit(10);
    expect(limited).not.toBe(col);
    limited.all();
    const limit = executor.lastStages!.find((s) => s.kind === 'limit') as MongoLimitStage;
    expect(limit.limit).toBe(10);
  });

  it('returns a new instance from offset()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const skipped = col.offset(5);
    expect(skipped).not.toBe(col);
    skipped.all();
    const skip = executor.lastStages!.find((s) => s.kind === 'skip') as MongoSkipStage;
    expect(skip.skip).toBe(5);
  });

  it('does not mutate original instance', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    col.where(MongoFieldFilter.eq('name', 'Alice'));
    col.all();
    expect(executor.lastStages!).toHaveLength(0);
  });

  it('chains where, orderBy, limit, offset together', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor)
      .where(MongoFieldFilter.eq('name', 'Alice'))
      .orderBy({ name: 1 })
      .offset(10)
      .limit(5);
    col.all();
    const stageKinds = executor.lastStages!.map((s) => s.kind);
    expect(stageKinds).toEqual(['match', 'sort', 'skip', 'limit']);
  });
});

describe('MongoCollection object-based where()', () => {
  it('produces eq filter with string codecId for string field', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor).where({ name: 'Alice' });
    col.all();
    const match = executor.lastStages![0] as MongoMatchStage;
    expect(match.filter.kind).toBe('field');
    if (match.filter.kind === 'field') {
      expect(match.filter.field).toBe('name');
      expect(match.filter.op).toBe('$eq');
      const ref = match.filter.value as MongoParamRef;
      expect(ref).toBeInstanceOf(MongoParamRef);
      expect(ref.codecId).toBe('mongo/string@1');
      expect(ref.value).toBe('Alice');
    }
  });

  it('produces eq filter with objectId codecId for ObjectId field', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor).where({
      assigneeId: 'abc123',
    });
    col.all();
    const match = executor.lastStages![0] as MongoMatchStage;
    expect(match.filter.kind).toBe('field');
    if (match.filter.kind === 'field') {
      expect(match.filter.field).toBe('assigneeId');
      expect(match.filter.op).toBe('$eq');
      const ref = match.filter.value as MongoParamRef;
      expect(ref).toBeInstanceOf(MongoParamRef);
      expect(ref.codecId).toBe('mongo/objectId@1');
      expect(ref.value).toBe('abc123');
    }
  });

  it('produces AND of multiple eq filters for multi-field object', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor).where({
      name: 'Alice',
      email: 'a@b.c',
    });
    col.all();
    const match = executor.lastStages![0] as MongoMatchStage;
    expect(match.filter.kind).toBe('and');
    if (match.filter.kind === 'and') {
      expect(match.filter.exprs).toHaveLength(2);
      const first = match.filter.exprs[0]!;
      const second = match.filter.exprs[1]!;
      expect(first.kind).toBe('field');
      expect(second.kind).toBe('field');
    }
  });

  it('chains with MongoFilterExpr where()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor)
      .where({ name: 'Alice' })
      .where(MongoFieldFilter.gte('email', 'a'));
    col.all();
    const match = executor.lastStages![0] as MongoMatchStage;
    expect(match.filter.kind).toBe('and');
  });

  it('chains MongoFilterExpr where() then object where()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor)
      .where(MongoFieldFilter.eq('_id', 'id-1'))
      .where({ name: 'Alice' });
    col.all();
    const match = executor.lastStages![0] as MongoMatchStage;
    expect(match.filter.kind).toBe('and');
  });
});

describe('createFieldAccessor()', () => {
  it('property access returns FieldExpression for top-level field', () => {
    const u = createFieldAccessor<Contract, 'User', CodecTypes>();
    const op = u.name.set('Bob');
    expect(op.operator).toBe('$set');
    expect(op.field).toBe('name');
    expect((op.value as MongoParamRef).value).toBe('Bob');
  });

  it('set() produces $set operation', () => {
    const u = createFieldAccessor<Contract, 'User', CodecTypes>();
    const op = u.name.set('Alice');
    expect(op.operator).toBe('$set');
    expect(op.field).toBe('name');
  });

  it('unset() produces $unset operation', () => {
    const u = createFieldAccessor<Contract, 'User', CodecTypes>();
    const op = u.name.unset();
    expect(op.operator).toBe('$unset');
    expect(op.field).toBe('name');
  });

  it('inc() produces $inc operation', () => {
    const u = createFieldAccessor<Contract, 'User', CodecTypes>();
    const op = (u.loginCount as FieldExpression<number>).inc(1);
    expect(op.operator).toBe('$inc');
    expect(op.field).toBe('loginCount');
    expect((op.value as MongoParamRef).value).toBe(1);
  });

  it('mul() produces $mul operation', () => {
    const u = createFieldAccessor<Contract, 'User', CodecTypes>();
    const op = (u.loginCount as FieldExpression<number>).mul(2);
    expect(op.operator).toBe('$mul');
    expect(op.field).toBe('loginCount');
    expect((op.value as MongoParamRef).value).toBe(2);
  });

  it('push() produces $push operation', () => {
    const u = createFieldAccessor<Contract, 'User', CodecTypes>();
    const op = u.tags.push('admin');
    expect(op.operator).toBe('$push');
    expect(op.field).toBe('tags');
    expect((op.value as MongoParamRef).value).toBe('admin');
  });

  it('pull() produces $pull operation', () => {
    const u = createFieldAccessor<Contract, 'User', CodecTypes>();
    const op = u.tags.pull('admin');
    expect(op.operator).toBe('$pull');
    expect(op.field).toBe('tags');
    expect((op.value as MongoParamRef).value).toBe('admin');
  });

  it('addToSet() produces $addToSet operation', () => {
    const u = createFieldAccessor<Contract, 'User', CodecTypes>();
    const op = u.tags.addToSet('admin');
    expect(op.operator).toBe('$addToSet');
    expect(op.field).toBe('tags');
  });

  it('pop() produces $pop operation', () => {
    const u = createFieldAccessor<Contract, 'User', CodecTypes>();
    const op = u.tags.pop(1);
    expect(op.operator).toBe('$pop');
    expect(op.field).toBe('tags');
    expect((op.value as MongoParamRef).value).toBe(1);
  });

  it('call signature returns FieldExpression for dot-path', () => {
    const u = createFieldAccessor<Contract, 'User', CodecTypes>();
    const op = u('homeAddress.city').set('NYC');
    expect(op.operator).toBe('$set');
    expect(op.field).toBe('homeAddress.city');
    expect((op.value as MongoParamRef).value).toBe('NYC');
  });
});

describe('compileFieldOperations()', () => {
  const identity = (_field: string, value: MongoValue) => value;

  it('groups operations by operator', () => {
    const ops: FieldOperation[] = [
      { operator: '$set', field: 'name', value: new MongoParamRef('Alice') },
      { operator: '$inc', field: 'loginCount', value: new MongoParamRef(1) },
      { operator: '$set', field: 'email', value: new MongoParamRef('a@b.c') },
    ];
    const result = compileFieldOperations(ops, identity);
    expect(result).toEqual({
      $set: {
        name: new MongoParamRef('Alice'),
        email: new MongoParamRef('a@b.c'),
      },
      $inc: {
        loginCount: new MongoParamRef(1),
      },
    });
  });

  it('applies wrapValue to each operation', () => {
    const ops: FieldOperation[] = [
      { operator: '$set', field: 'name', value: new MongoParamRef('Alice') },
    ];
    const wrap = (_field: string, value: MongoValue) =>
      new MongoParamRef((value as MongoParamRef).value, { codecId: 'mongo/string@1' });
    const result = compileFieldOperations(ops, wrap);
    expect(result['$set']!['name']!).toBeInstanceOf(MongoParamRef);
    expect((result['$set']!['name']! as MongoParamRef).codecId).toBe('mongo/string@1');
  });

  it('passes operator to wrapValue callback', () => {
    const ops: FieldOperation[] = [
      { operator: '$set', field: 'name', value: new MongoParamRef('Alice') },
      { operator: '$unset', field: 'email', value: new MongoParamRef('') },
    ];
    const operators: string[] = [];
    compileFieldOperations(ops, (_field, value, operator) => {
      operators.push(operator);
      return value;
    });
    expect(operators).toEqual(['$set', '$unset']);
  });
});

describe('MongoCollection variant()', () => {
  it('returns a new instance from variant()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor);
    const narrowed = col.variant('Bug');
    expect(narrowed).not.toBe(col);
  });

  it('injects discriminator eq filter for the variant value', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor).variant('Bug');
    col.all();
    const match = executor.lastStages![0] as MongoMatchStage;
    expect(match.filter.kind).toBe('field');
    if (match.filter.kind === 'field') {
      expect(match.filter.field).toBe('type');
      expect(match.filter.op).toBe('$eq');
    }
  });

  it('does not mutate original collection', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor);
    col.variant('Bug');
    col.all();
    expect(executor.lastStages!).toHaveLength(0);
  });

  it('composes with where()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor)
      .variant('Feature')
      .where(MongoFieldFilter.eq('title', 'Login'));
    col.all();
    const match = executor.lastStages![0] as MongoMatchStage;
    expect(match.filter.kind).toBe('and');
  });

  it('returns self when model has no discriminator (non-polymorphic)', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    // @ts-expect-error VariantNames<Contract, 'User'> is never
    const result = col.variant('NonExistent');
    expect(result).toBe(col);
  });

  it('create() injects discriminator value into the document', async () => {
    const executor = createMockExecutor([{ insertedId: 'new-id' }]);
    const col = createMongoCollection(contract, 'Task', executor).variant('Bug');
    await col.create({ title: 'Fix crash', severity: 'high', assigneeId: 'u1' } as never);
    const command = executor.lastPlan!.command;
    expect(command.kind).toBe('insertOne');
    if (command.kind === 'insertOne') {
      expect(command.document).toHaveProperty('type');
    }
  });

  it('create() returns row including discriminator value', async () => {
    const executor = createMockExecutor([{ insertedId: 'new-id' }]);
    const col = createMongoCollection(contract, 'Task', executor).variant('Bug');
    const result = await col.create({
      title: 'Fix crash',
      severity: 'high',
      assigneeId: 'u1',
    } as never);
    expect((result as Record<string, unknown>)['type']).toBe('bug');
  });

  it('createAll() injects discriminator value into each document', async () => {
    const executor = createMockExecutor([{ insertedIds: ['id-1', 'id-2'], insertedCount: 2 }]);
    const col = createMongoCollection(contract, 'Task', executor).variant('Bug');
    const rows: unknown[] = [];
    for await (const row of col.createAll([
      { title: 'Bug 1', severity: 'low', assigneeId: 'u1' },
      { title: 'Bug 2', severity: 'high', assigneeId: 'u2' },
    ] as never)) {
      rows.push(row);
    }
    expect(rows).toHaveLength(2);
    expect((rows[0] as Record<string, unknown>)['type']).toBe('bug');
    expect((rows[1] as Record<string, unknown>)['type']).toBe('bug');
  });
});

describe('MongoCollection include()', () => {
  it('adds a relation include', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor).include('assignee');
    col.all();
    const lookup = executor.lastStages!.find((s) => s.kind === 'lookup') as MongoLookupStage;
    expect(lookup.from).toBe('users');
    expect(lookup.localField).toBe('assigneeId');
    expect(lookup.foreignField).toBe('_id');
    expect(lookup.as).toBe('assignee');
  });

  it('throws for unknown relation', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor);
    // @ts-expect-error 'nonexistent' is not a valid reference relation key
    expect(() => col.include('nonexistent')).toThrow('Unknown relation');
  });

  it('throws for embed relation', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor);
    // @ts-expect-error 'comments' is an embed relation, not a reference relation
    expect(() => col.include('comments')).toThrow('embed relation');
  });

  it('produces $lookup without $unwind for 1:N reference relation', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor).include('tasks');
    col.all();
    const stages = executor.lastStages!;
    const lookup = stages.find((s) => s.kind === 'lookup') as MongoLookupStage;
    expect(lookup.from).toBe('tasks');
    expect(lookup.localField).toBe('_id');
    expect(lookup.foreignField).toBe('assigneeId');
    expect(lookup.as).toBe('tasks');
    const unwind = stages.find((s) => s.kind === 'unwind');
    expect(unwind).toBeUndefined();
  });
});

describe('MongoCollection terminal methods', () => {
  it('all() executes the compiled plan', () => {
    const executor = createMockExecutor([{ _id: '1', name: 'Alice', email: 'a@b.c' }]);
    const col = createMongoCollection(contract, 'User', executor);
    col.all();
    expect(executor.lastPlan).toBeDefined();
    expect(executor.lastPlan!.collection).toBe('users');
    expect(executor.lastPlan!.command.kind).toBe('aggregate');
  });

  it('first() returns the first row', async () => {
    const executor = createMockExecutor([
      { _id: '1', name: 'Alice', email: 'a@b.c' },
      { _id: '2', name: 'Bob', email: 'b@b.c' },
    ]);
    const col = createMongoCollection(contract, 'User', executor);
    const result = await col.first();
    expect(result).toEqual({ _id: '1', name: 'Alice', email: 'a@b.c' });
  });

  it('first() returns null when no results', async () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const result = await col.first();
    expect(result).toBeNull();
  });

  it('first() sets limit 1 on the compiled plan', async () => {
    const executor = createMockExecutor([{ _id: '1', name: 'Alice', email: 'a@b.c' }]);
    const col = createMongoCollection(contract, 'User', executor);
    await col.first();
    const limitStage = executor.lastStages!.find((s) => s.kind === 'limit') as
      | MongoLimitStage
      | undefined;
    expect(limitStage?.limit).toBe(1);
  });
});

describe('MongoCollection write methods', () => {
  describe('create()', () => {
    it('returns created row with _id from insertedId', async () => {
      const executor = createMockExecutor([{ insertedId: 'new-id-1' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col.create(defaultUserData);
      expect(result).toEqual({ _id: 'new-id-1', ...defaultUserData });
    });

    it('sends an InsertOneCommand', async () => {
      const executor = createMockExecutor([{ insertedId: 'id' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.create({ ...defaultUserData, name: 'Bob', email: 'b@b.c' });
      expect(executor.lastCommand).toBeDefined();
      expect(executor.lastCommand!.kind).toBe('insertOne');
      expect(executor.lastCommand!.collection).toBe('users');
    });

    it('attaches codecId from contract fields to MongoParamRef in document', async () => {
      const executor = createMockExecutor([{ insertedId: 'id' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.create(defaultUserData);
      const command = executor.lastCommand!;
      expect(command.kind).toBe('insertOne');
      if (command.kind === 'insertOne') {
        const nameRef = command.document['name'] as MongoParamRef;
        expect(nameRef).toBeInstanceOf(MongoParamRef);
        expect(nameRef.codecId).toBe('mongo/string@1');
        const emailRef = command.document['email'] as MongoParamRef;
        expect(emailRef).toBeInstanceOf(MongoParamRef);
        expect(emailRef.codecId).toBe('mongo/string@1');
      }
    });

    it('attaches objectId codecId for ObjectId-typed fields', async () => {
      const executor = createMockExecutor([{ insertedId: 'id' }]);
      const col = createMongoCollection(contract, 'Task', executor);
      await col.create({ title: 'Fix bug', assigneeId: 'abc123', type: 'bug' });
      const command = executor.lastCommand!;
      expect(command.kind).toBe('insertOne');
      if (command.kind === 'insertOne') {
        const assigneeRef = command.document['assigneeId'] as MongoParamRef;
        expect(assigneeRef).toBeInstanceOf(MongoParamRef);
        expect(assigneeRef.codecId).toBe('mongo/objectId@1');
      }
    });

    it('attaches a result shape decoding insertedId via the _id codec', async () => {
      const executor = createMockExecutor([{ insertedId: 'id' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.create(defaultUserData);
      expect(executor.lastPlan!.resultShape).toEqual({
        kind: 'document',
        fields: { insertedId: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false } },
      });
    });
  });

  describe('createAll()', () => {
    it('returns all created rows with _ids', async () => {
      const executor = createMockExecutor([{ insertedIds: ['id-1', 'id-2'], insertedCount: 2 }]);
      const col = createMongoCollection(contract, 'User', executor);
      const rows: unknown[] = [];
      for await (const row of col.createAll([
        defaultUserData,
        { ...defaultUserData, name: 'Bob', email: 'b@b.c' },
      ])) {
        rows.push(row);
      }
      expect(rows).toEqual([
        { _id: 'id-1', ...defaultUserData },
        { _id: 'id-2', ...defaultUserData, name: 'Bob', email: 'b@b.c' },
      ]);
    });

    it('attaches a result shape decoding each insertedId via the _id codec', async () => {
      const executor = createMockExecutor([{ insertedIds: ['id-1'], insertedCount: 1 }]);
      const col = createMongoCollection(contract, 'User', executor);
      for await (const _row of col.createAll([defaultUserData])) {
        // drain
      }
      expect(executor.lastPlan!.resultShape).toEqual({
        kind: 'document',
        fields: {
          insertedIds: {
            kind: 'array',
            nullable: false,
            element: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
          },
        },
      });
    });
  });

  describe('createAndCount()', () => {
    it('returns the count of inserted documents', async () => {
      const executor = createMockExecutor([{ insertedIds: ['a', 'b'], insertedCount: 2 }]);
      const col = createMongoCollection(contract, 'User', executor);
      const count = await col.createAndCount([
        defaultUserData,
        { ...defaultUserData, name: 'Bob', email: 'b@b.c' },
      ]);
      expect(count).toBe(2);
    });
  });

  describe('update()', () => {
    it('throws without .where()', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(col.update({ name: 'Changed' })).rejects.toThrow('requires a .where()');
    });

    it('returns updated row via findOneAndUpdate', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Updated', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col
        .where(MongoFieldFilter.eq('_id', 'id-1'))
        .update({ name: 'Updated' });
      expect(result).toEqual({ _id: 'id-1', name: 'Updated', email: 'a@b.c' });
      expect(executor.lastCommand!.kind).toBe('findOneAndUpdate');
    });

    it('passes MongoFilterExpr to command', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Updated', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).update({ name: 'Updated' });
      const command = executor.lastCommand!;
      expect(command.kind).toBe('findOneAndUpdate');
      if (command.kind === 'findOneAndUpdate') {
        expect(command.filter).not.toBeNull();
        expect(command.filter!.kind).toBe('field');
      }
    });

    it('returns null when no match', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col.where(MongoFieldFilter.eq('_id', 'missing')).update({ name: 'X' });
      expect(result).toBeNull();
    });

    it('attaches codecId to $set fields from contract', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Updated', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).update({ name: 'Updated' });
      const command = executor.lastCommand!;
      expect(command.kind).toBe('findOneAndUpdate');
      if (command.kind === 'findOneAndUpdate') {
        const update = command.update as Record<string, Record<string, MongoParamRef>>;
        const nameRef = update['$set']!['name']!;
        expect(nameRef).toBeInstanceOf(MongoParamRef);
        expect(nameRef.codecId).toBe('mongo/string@1');
      }
    });

    it('attaches the model result shape so the returned document decodes like a read', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Updated', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).update({ name: 'Updated' });
      const shape = executor.lastPlan!.resultShape;
      expect(shape).toBeDefined();
      expect(shape!.kind).toBe('document');
      if (shape!.kind === 'document') {
        expect(shape!.fields['_id']).toEqual({
          kind: 'leaf',
          codecId: 'mongo/objectId@1',
          nullable: false,
        });
      }
    });
  });

  describe('update() with callback', () => {
    it('produces correct update doc from field operations', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Updated' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col
        .where(MongoFieldFilter.eq('_id', 'id-1'))
        .update((u) => [u.name.set('Updated'), u.loginCount.inc(1)]);
      const command = executor.lastCommand!;
      expect(command.kind).toBe('findOneAndUpdate');
      if (command.kind === 'findOneAndUpdate') {
        const update = command.update as Record<string, Record<string, MongoParamRef>>;
        expect(update['$set']!['name']).toBeInstanceOf(MongoParamRef);
        expect(update['$inc']!['loginCount']).toBeInstanceOf(MongoParamRef);
      }
    });

    it('applies codec to callback operations for scalar fields', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Updated' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).update((u) => [u.name.set('Updated')]);
      const command = executor.lastCommand!;
      if (command.kind === 'findOneAndUpdate') {
        const update = command.update as Record<string, Record<string, MongoParamRef>>;
        expect(update['$set']!['name']!.codecId).toBe('mongo/string@1');
      }
    });

    it('produces $push operations from callback', async () => {
      const executor = createMockExecutor([{ _id: 'id-1' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).update((u) => [u.tags.push('admin')]);
      const command = executor.lastCommand!;
      if (command.kind === 'findOneAndUpdate') {
        const update = command.update as Record<string, Record<string, MongoParamRef>>;
        expect(update['$push']).toBeDefined();
        expect(update['$push']!['tags']).toBeInstanceOf(MongoParamRef);
      }
    });

    it('does not attach codecId to $unset sentinel value', async () => {
      const executor = createMockExecutor([{ _id: 'id-1' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).update((u) => [u.name.unset()]);
      const command = executor.lastCommand!;
      if (command.kind === 'findOneAndUpdate') {
        const update = command.update as Record<string, Record<string, MongoParamRef>>;
        const unsetRef = update['$unset']!['name']!;
        expect(unsetRef).toBeInstanceOf(MongoParamRef);
        expect(unsetRef.codecId).toBeUndefined();
        expect(unsetRef.value).toBe('');
      }
    });

    it('produces dot-path operations from callback', async () => {
      const executor = createMockExecutor([{ _id: 'id-1' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col
        .where(MongoFieldFilter.eq('_id', 'id-1'))
        .update((u) => [u('homeAddress.city').set('NYC')]);
      const command = executor.lastCommand!;
      if (command.kind === 'findOneAndUpdate') {
        const update = command.update as Record<string, Record<string, MongoParamRef>>;
        expect(update['$set']!['homeAddress.city']).toBeInstanceOf(MongoParamRef);
        expect(update['$set']!['homeAddress.city']!.codecId).toBe('mongo/string@1');
      }
    });

    it('normalizes empty callback to { $set: {} }', async () => {
      const executor = createMockExecutor([{ _id: 'id-1' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).update(() => []);
      const command = executor.lastCommand!;
      if (command.kind === 'findOneAndUpdate') {
        expect(command.update).toEqual({ $set: {} });
      }
    });

    it('wraps value-object payload through codec in set()', async () => {
      const executor = createMockExecutor([{ _id: 'id-1' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col
        .where(MongoFieldFilter.eq('_id', 'id-1'))
        .update((u) => [u.homeAddress.set({ city: 'NYC', country: 'US' })]);
      const command = executor.lastCommand!;
      if (command.kind === 'findOneAndUpdate') {
        const update = command.update as Record<string, Record<string, unknown>>;
        const setDoc = update['$set']!['homeAddress'] as Record<string, MongoParamRef>;
        expect(setDoc['city']).toBeInstanceOf(MongoParamRef);
        expect(setDoc['city']!.codecId).toBe('mongo/string@1');
        expect(setDoc['country']).toBeInstanceOf(MongoParamRef);
        expect(setDoc['country']!.codecId).toBe('mongo/string@1');
      }
    });
  });

  describe('updateAll() with callback', () => {
    it('produces correct update doc from field operations', async () => {
      const executor = createMockExecutor(
        [{ _id: 'id-1' }, { _id: 'id-2' }],
        [{ matchedCount: 2, modifiedCount: 2 }],
        [
          { _id: 'id-1', name: 'Alice', loginCount: 1 },
          { _id: 'id-2', name: 'Bob', loginCount: 1 },
        ],
      );
      const col = createMongoCollection(contract, 'User', executor);
      const rows: unknown[] = [];
      for await (const row of col
        .where(MongoFieldFilter.eq('email', 'a@b.c'))
        .updateAll((u) => [u.loginCount.inc(1)])) {
        rows.push(row);
      }
      expect(rows).toHaveLength(2);
      const updateCommand = executor.lastPlan;
      expect(updateCommand).toBeDefined();
    });
  });

  describe('updateAndCount() with callback', () => {
    it('produces correct update doc from field operations', async () => {
      const executor = createMockExecutor({ affectedRows: 1 });
      const col = createMongoCollection(contract, 'User', executor);
      const count = await col
        .where(MongoFieldFilter.eq('email', 'a'))
        .updateAndCount((u) => [u.name.set('X')]);
      expect(count).toBe(1);
      expect(executor.lastOperation).toBe('execute');
    });
  });

  describe('upsert() with callback', () => {
    it('uses field operations for update part', async () => {
      const executor = createMockExecutor([{ _id: 'new-id' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('email', 'a@b.c')).upsert({
        create: defaultUserData,
        update: (u: FieldAccessor<Contract, 'User'>) => [u.loginCount.inc(1)],
      });
      const command = executor.lastCommand!;
      if (command.kind === 'findOneAndUpdate') {
        const update = command.update as Record<string, Record<string, MongoParamRef>>;
        expect(update['$inc']!['loginCount']).toBeInstanceOf(MongoParamRef);
        expect(update['$setOnInsert']).toBeDefined();
      }
    });

    it('throws when callback produces dot-path operations', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(
        col.where(MongoFieldFilter.eq('email', 'a@b.c')).upsert({
          create: { ...defaultUserData, homeAddress: { city: 'SF', country: 'US' } },
          update: (u) => [u('homeAddress.city').set('LA')],
        }),
      ).rejects.toThrow('dot-path');
    });
  });

  describe('updateAndCount()', () => {
    it('throws without .where()', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(col.updateAndCount({ name: 'X' })).rejects.toThrow('requires a .where()');
    });

    it('returns the modified count', async () => {
      const executor = createMockExecutor({ affectedRows: 3 });
      const col = createMongoCollection(contract, 'User', executor);
      const count = await col
        .where(MongoFieldFilter.eq('email', 'a'))
        .updateAndCount({ name: 'X' });
      expect(count).toBe(3);
      expect(executor.lastOperation).toBe('execute');
    });
  });

  describe('delete()', () => {
    it('throws without .where()', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(col.delete()).rejects.toThrow('requires a .where()');
    });

    it('returns deleted row via findOneAndDelete', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Alice', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col.where(MongoFieldFilter.eq('_id', 'id-1')).delete();
      expect(result).toEqual({ _id: 'id-1', name: 'Alice', email: 'a@b.c' });
      expect(executor.lastCommand!.kind).toBe('findOneAndDelete');
    });

    it('passes MongoFilterExpr to command', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Alice', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).delete();
      const command = executor.lastCommand!;
      expect(command.kind).toBe('findOneAndDelete');
      if (command.kind === 'findOneAndDelete') {
        expect(command.filter.kind).toBe('field');
      }
    });

    it('returns null when no match', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col.where(MongoFieldFilter.eq('_id', 'none')).delete();
      expect(result).toBeNull();
    });

    it('attaches the model result shape so the returned document decodes like a read', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Alice', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).delete();
      const shape = executor.lastPlan!.resultShape;
      expect(shape).toBeDefined();
      expect(shape!.kind).toBe('document');
    });
  });

  describe('deleteAndCount()', () => {
    it('throws without .where()', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(col.deleteAndCount()).rejects.toThrow('requires a .where()');
    });

    it('returns the deleted count', async () => {
      const executor = createMockExecutor({ affectedRows: 2 });
      const col = createMongoCollection(contract, 'User', executor);
      const count = await col.where(MongoFieldFilter.eq('email', 'x')).deleteAndCount();
      expect(count).toBe(2);
      expect(executor.lastOperation).toBe('execute');
    });
  });

  describe('upsert()', () => {
    it('sends findOneAndUpdate with upsert true', async () => {
      const executor = createMockExecutor([{ _id: 'new-id', name: 'Alice', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col.where(MongoFieldFilter.eq('email', 'a@b.c')).upsert({
        create: defaultUserData,
        update: { name: 'Alice Updated' },
      });
      expect(result).toEqual({ _id: 'new-id', name: 'Alice', email: 'a@b.c' });
      expect(executor.lastCommand!.kind).toBe('findOneAndUpdate');
    });

    it('attaches the model result shape so the returned document decodes like a read', async () => {
      const executor = createMockExecutor([{ _id: 'new-id', name: 'Alice', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('email', 'a@b.c')).upsert({
        create: defaultUserData,
        update: { name: 'Alice Updated' },
      });
      const shape = executor.lastPlan!.resultShape;
      expect(shape).toBeDefined();
      expect(shape!.kind).toBe('document');
    });

    it('throws without .where()', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(
        col.upsert({
          create: { ...defaultUserData, name: 'A' },
          update: { name: 'B' },
        }),
      ).rejects.toThrow('requires a .where()');
    });
  });

  describe('windowing rejection on mutations', () => {
    function withFilter(executor: MongoQueryExecutor) {
      return createMongoCollection(contract, 'User', executor).where(
        MongoFieldFilter.eq('name', 'Alice'),
      );
    }

    it('update() throws with orderBy', async () => {
      const executor = createMockExecutor();
      await expect(withFilter(executor).orderBy({ name: 1 }).update({ name: 'X' })).rejects.toThrow(
        'orderBy/offset/limit',
      );
    });

    it('updateAll() throws with limit', () => {
      const executor = createMockExecutor();
      expect(() => withFilter(executor).limit(5).updateAll({ name: 'X' })).toThrow(
        'orderBy/offset/limit',
      );
    });

    it('updateAndCount() throws with offset', async () => {
      const executor = createMockExecutor();
      await expect(withFilter(executor).offset(2).updateAndCount({ name: 'X' })).rejects.toThrow(
        'orderBy/offset/limit',
      );
    });

    it('delete() throws with limit', async () => {
      const executor = createMockExecutor();
      await expect(withFilter(executor).limit(1).delete()).rejects.toThrow('orderBy/offset/limit');
    });

    it('deleteAll() throws with orderBy', () => {
      const executor = createMockExecutor();
      expect(() => withFilter(executor).orderBy({ name: -1 }).deleteAll()).toThrow(
        'orderBy/offset/limit',
      );
    });

    it('deleteAndCount() throws with offset', async () => {
      const executor = createMockExecutor();
      await expect(withFilter(executor).offset(3).deleteAndCount()).rejects.toThrow(
        'orderBy/offset/limit',
      );
    });

    it('upsert() throws with limit', async () => {
      const executor = createMockExecutor();
      await expect(
        withFilter(executor)
          .limit(1)
          .upsert({ create: { ...defaultUserData, name: 'A' }, update: { name: 'B' } }),
      ).rejects.toThrow('orderBy/offset/limit');
    });
  });

  describe('updateAll()', () => {
    it('re-reads by _id after update, not original filter', async () => {
      const executor = createMockExecutor(
        [{ _id: 'id-1' }, { _id: 'id-2' }],
        [{ matchedCount: 2, modifiedCount: 2 }],
        [
          { _id: 'id-1', name: 'Updated', email: 'a@b.c' },
          { _id: 'id-2', name: 'Updated', email: 'b@b.c' },
        ],
      );
      const col = createMongoCollection(contract, 'User', executor);
      const rows: unknown[] = [];
      for await (const row of col
        .where(MongoFieldFilter.eq('name', 'Alice'))
        .updateAll({ name: 'Updated' })) {
        rows.push(row);
      }
      expect(rows).toHaveLength(2);
      const reReadPlan = executor.lastPlan!;
      expect(reReadPlan.command.kind).toBe('aggregate');
      if (reReadPlan.command.kind === 'aggregate') {
        const matchStage = reReadPlan.command.pipeline[0] as MongoMatchStage;
        expect(matchStage.filter.kind).toBe('field');
        if (matchStage.filter.kind === 'field') {
          expect(matchStage.filter.field).toBe('_id');
          expect(matchStage.filter.op).toBe('$in');
        }
      }
    });
  });

  describe('include rejection on write terminals', () => {
    function taskWithInclude(executor: MongoQueryExecutor) {
      return createMongoCollection(contract, 'Task', executor)
        .where(MongoFieldFilter.eq('title', 'test'))
        .include('assignee');
    }

    it('create() throws with .include()', async () => {
      const executor = createMockExecutor();
      await expect(
        createMongoCollection(contract, 'Task', executor)
          .include('assignee')
          .create({ title: 'test', type: 'bug', assigneeId: 'u1' }),
      ).rejects.toThrow('include');
    });

    it('createAll() throws with .include()', () => {
      const executor = createMockExecutor();
      expect(() =>
        createMongoCollection(contract, 'Task', executor)
          .include('assignee')
          .createAll([{ title: 'test', type: 'bug', assigneeId: 'u1' }]),
      ).toThrow('include');
    });

    it('update() throws with .include()', async () => {
      const executor = createMockExecutor();
      await expect(taskWithInclude(executor).update({ title: 'X' })).rejects.toThrow('include');
    });

    it('delete() throws with .include()', async () => {
      const executor = createMockExecutor();
      await expect(taskWithInclude(executor).delete()).rejects.toThrow('include');
    });

    it('upsert() throws with .include()', async () => {
      const executor = createMockExecutor();
      await expect(
        taskWithInclude(executor).upsert({
          create: { title: 'A', type: 'bug', assigneeId: 'u1' },
          update: { title: 'B' },
        }),
      ).rejects.toThrow('include');
    });
  });

  describe('undefined normalization on create paths', () => {
    it('create() strips undefined from fabricated row', async () => {
      const executor = createMockExecutor([{ insertedId: 'new-id' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const input = { name: 'Alice', email: 'a@b.c', extra: undefined } as Record<string, unknown>;
      const result = await col.create(input as never);
      expect(result).toEqual({ _id: 'new-id', name: 'Alice', email: 'a@b.c' });
      expect('extra' in (result as Record<string, unknown>)).toBe(false);
    });

    it('createAll() strips undefined from fabricated rows', async () => {
      const executor = createMockExecutor([{ insertedIds: ['id-1'], insertedCount: 1 }]);
      const col = createMongoCollection(contract, 'User', executor);
      const input = [{ name: 'Alice', email: 'a@b.c', extra: undefined }] as Record<
        string,
        unknown
      >[];
      const rows: unknown[] = [];
      for await (const row of col.createAll(input as never)) {
        rows.push(row);
      }
      expect(rows).toEqual([{ _id: 'id-1', name: 'Alice', email: 'a@b.c' }]);
      expect('extra' in (rows[0] as Record<string, unknown>)).toBe(false);
    });
  });

  describe('_id rejection on update paths', () => {
    it('update() throws when _id is in update data', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(
        col.where(MongoFieldFilter.eq('_id', 'id-1')).update({ _id: 'new-id', name: 'X' }),
      ).rejects.toThrow('_id');
    });

    it('updateAndCount() throws when _id is in update data', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(
        col.where(MongoFieldFilter.eq('_id', 'id-1')).updateAndCount({ _id: 'new-id' }),
      ).rejects.toThrow('_id');
    });

    it('updateAll() throws when _id is in update data', async () => {
      const executor = createMockExecutor([{ _id: 'id-1' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const result = col
        .where(MongoFieldFilter.eq('_id', 'id-1'))
        .updateAll({ _id: 'new-id', name: 'X' });
      await expect(async () => {
        for await (const _ of result) {
          /* drain */
        }
      }).rejects.toThrow('_id');
    });

    it('upsert() throws when _id is in update data', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(
        col.where(MongoFieldFilter.eq('email', 'a@b.c')).upsert({
          create: defaultUserData,
          update: { _id: 'new-id', name: 'B' },
        }),
      ).rejects.toThrow('_id');
    });

    it('update() with callback throws when _id is targeted', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(
        col.where(MongoFieldFilter.eq('_id', 'id-1')).update((u) => [u._id.set('new-id')]),
      ).rejects.toThrow('_id');
    });

    it('updateAll() with callback throws when _id is targeted', async () => {
      const executor = createMockExecutor([{ _id: 'id-1' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const result = col
        .where(MongoFieldFilter.eq('_id', 'id-1'))
        .updateAll((u: FieldAccessor<Contract, 'User'>) => [u._id.set('new-id')]);
      await expect(async () => {
        for await (const _ of result) {
          /* drain */
        }
      }).rejects.toThrow('_id');
    });

    it('upsert() with callback throws when _id is targeted', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(
        col.where(MongoFieldFilter.eq('email', 'a@b.c')).upsert({
          create: defaultUserData,
          update: (u: FieldAccessor<Contract, 'User'>) => [u._id.set('new-id')],
        }),
      ).rejects.toThrow('_id');
    });
  });

  describe('immutability', () => {
    it('write methods do not mutate collection state', async () => {
      const executor = createMockExecutor([{ insertedId: 'x' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.create(defaultUserData);
      const filtered = col.where(MongoFieldFilter.eq('name', 'Alice'));
      expect(filtered).not.toBe(col);
    });
  });
});
