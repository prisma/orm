import { describe, expect, it } from 'vitest';
import {
  RawAggregateCommand,
  RawDeleteManyCommand,
  RawDeleteOneCommand,
  RawFindOneAndDeleteCommand,
  RawFindOneAndUpdateCommand,
  RawInsertManyCommand,
  RawInsertOneCommand,
  RawUpdateManyCommand,
  RawUpdateOneCommand,
} from '../src/raw-commands';

describe('RawAggregateCommand', () => {
  const pipeline = [
    { $match: { status: 'active' } },
    { $group: { _id: '$dept', total: { $sum: '$amount' } } },
  ];

  it('stores collection and pipeline', () => {
    const cmd = new RawAggregateCommand('orders', pipeline);
    expect(cmd.kind).toBe('rawAggregate');
    expect(cmd.collection).toBe('orders');
    expect(cmd.pipeline).toEqual(pipeline);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new RawAggregateCommand('orders', pipeline))).toBe(true);
  });
});

describe('RawInsertOneCommand', () => {
  const doc = { name: 'Alice', email: 'alice@example.com' };

  it('stores collection and document', () => {
    const cmd = new RawInsertOneCommand('users', doc);
    expect(cmd.kind).toBe('rawInsertOne');
    expect(cmd.collection).toBe('users');
    expect(cmd.document).toEqual(doc);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new RawInsertOneCommand('users', doc))).toBe(true);
  });
});

describe('RawInsertManyCommand', () => {
  const docs = [
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Bob', email: 'bob@example.com' },
  ];

  it('stores collection and documents', () => {
    const cmd = new RawInsertManyCommand('users', docs);
    expect(cmd.kind).toBe('rawInsertMany');
    expect(cmd.collection).toBe('users');
    expect(cmd.documents).toEqual(docs);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new RawInsertManyCommand('users', docs))).toBe(true);
  });
});

describe('RawUpdateOneCommand', () => {
  const filter = { email: 'alice@example.com' };
  const update = { $set: { name: 'Alice B' } };

  it('stores collection, filter, and object update', () => {
    const cmd = new RawUpdateOneCommand('users', filter, update);
    expect(cmd.kind).toBe('rawUpdateOne');
    expect(cmd.collection).toBe('users');
    expect(cmd.filter).toEqual(filter);
    expect(cmd.update).toEqual(update);
  });

  it('carries bypassDocumentValidation only when given', () => {
    const plain = new RawUpdateManyCommand('users', filter, update);
    const bypassing = new RawUpdateManyCommand('users', filter, update, {
      bypassDocumentValidation: true,
    });
    expect({
      plainHasKey: 'bypassDocumentValidation' in plain,
      bypassing: bypassing.bypassDocumentValidation,
    }).toEqual({ plainHasKey: false, bypassing: true });
  });

  it('accepts pipeline-style update (array)', () => {
    const pipelineUpdate = [{ $set: { fullName: { $concat: ['$first', ' ', '$last'] } } }];
    const cmd = new RawUpdateOneCommand('users', filter, pipelineUpdate);
    expect(cmd.update).toEqual(pipelineUpdate);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new RawUpdateOneCommand('users', filter, update))).toBe(true);
  });
});

describe('RawUpdateManyCommand', () => {
  const filter = { status: 'inactive' };
  const update = { $set: { archived: true } };

  it('stores collection, filter, and object update', () => {
    const cmd = new RawUpdateManyCommand('users', filter, update);
    expect(cmd.kind).toBe('rawUpdateMany');
    expect(cmd.collection).toBe('users');
    expect(cmd.filter).toEqual(filter);
    expect(cmd.update).toEqual(update);
  });

  it('accepts pipeline-style update (array)', () => {
    const pipelineUpdate = [{ $set: { fullName: { $concat: ['$first', ' ', '$last'] } } }];
    const cmd = new RawUpdateManyCommand('users', filter, pipelineUpdate);
    expect(cmd.update).toEqual(pipelineUpdate);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new RawUpdateManyCommand('users', filter, update))).toBe(true);
  });
});

describe('RawDeleteOneCommand', () => {
  const filter = { email: 'alice@example.com' };

  it('stores collection and filter', () => {
    const cmd = new RawDeleteOneCommand('users', filter);
    expect(cmd.kind).toBe('rawDeleteOne');
    expect(cmd.collection).toBe('users');
    expect(cmd.filter).toEqual(filter);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new RawDeleteOneCommand('users', filter))).toBe(true);
  });
});

describe('RawDeleteManyCommand', () => {
  const filter = { status: 'expired' };

  it('stores collection and filter', () => {
    const cmd = new RawDeleteManyCommand('sessions', filter);
    expect(cmd.kind).toBe('rawDeleteMany');
    expect(cmd.collection).toBe('sessions');
    expect(cmd.filter).toEqual(filter);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new RawDeleteManyCommand('sessions', filter))).toBe(true);
  });
});

describe('RawFindOneAndUpdateCommand', () => {
  const filter = { _id: 'counter1' };
  const update = { $inc: { count: 1 } };

  it('stores collection, filter, update, and upsert', () => {
    const cmd = new RawFindOneAndUpdateCommand('counters', filter, update, true);
    expect(cmd.kind).toBe('rawFindOneAndUpdate');
    expect(cmd.collection).toBe('counters');
    expect(cmd.filter).toEqual(filter);
    expect(cmd.update).toEqual(update);
    expect(cmd.upsert).toBe(true);
  });

  it('accepts pipeline-style update (array)', () => {
    const pipelineUpdate = [{ $set: { fullName: { $concat: ['$first', ' ', '$last'] } } }];
    const cmd = new RawFindOneAndUpdateCommand('users', filter, pipelineUpdate, false);
    expect(cmd.update).toEqual(pipelineUpdate);
  });

  it('leaves returnDocument undefined when not supplied so the driver default applies', () => {
    const cmd = new RawFindOneAndUpdateCommand('counters', filter, update, false);
    expect(cmd.returnDocument).toBeUndefined();
  });

  it('threads an explicit returnDocument through to the command', () => {
    const cmd = new RawFindOneAndUpdateCommand(
      'counters',
      filter,
      update,
      false,
      undefined,
      'after',
    );
    expect(cmd.returnDocument).toBe('after');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new RawFindOneAndUpdateCommand('counters', filter, update, false))).toBe(
      true,
    );
  });
});

describe('RawFindOneAndDeleteCommand', () => {
  const filter = { email: 'alice@example.com' };

  it('stores collection and filter', () => {
    const cmd = new RawFindOneAndDeleteCommand('users', filter);
    expect(cmd.kind).toBe('rawFindOneAndDelete');
    expect(cmd.collection).toBe('users');
    expect(cmd.filter).toEqual(filter);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new RawFindOneAndDeleteCommand('users', filter))).toBe(true);
  });
});
