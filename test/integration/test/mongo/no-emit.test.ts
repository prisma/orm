import { mongoOrm } from '@internal/mongo-orm';
import { ObjectId } from 'mongodb';
import { expect, expectTypeOf, it } from 'vitest';
import { contract } from './fixtures/contract';
import { describeWithMongoDB } from './setup';

describeWithMongoDB('Mongo no-emit integration', (ctx) => {
  it('mongoOrm executes with a builder-authored contract directly', async () => {
    const db = ctx.client.db(ctx.dbName);
    const userId = new ObjectId();
    const taskId = new ObjectId();
    const commentId = new ObjectId();

    await db.collection('users').insertOne({
      _id: userId,
      name: 'Alice',
      email: 'alice@example.com',
      addresses: [],
    });
    await db.collection('tasks').insertOne({
      _id: taskId,
      title: 'Fix bug',
      type: 'bug',
      assigneeId: userId,
      severity: 'high',
      comments: [{ _id: commentId, text: 'Investigating', createdAt: new Date('2025-01-01') }],
    });

    const orm = mongoOrm({ contract, executor: ctx.runtime, codecs: ctx.codecs });
    const tasks = await orm.tasks.include('assignee').all();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Fix bug',
      assignee: {
        name: 'Alice',
        email: 'alice@example.com',
      },
    });
    expect(tasks[0]!.comments[0]).toMatchObject({
      text: 'Investigating',
    });

    expectTypeOf(tasks[0]!.comments[0]!.createdAt).toEqualTypeOf<Date>();

    if (tasks[0]!.type === 'bug') {
      expectTypeOf(tasks[0]!.severity).toEqualTypeOf<string>();
    }
  });
});
