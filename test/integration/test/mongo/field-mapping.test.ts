import mongoAdapter from '@internal/adapter-mongo/control';
import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack } from '@internal/framework-components/control';
import { defineContract } from '@internal/mongo/contract-builder';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { mongoContextInput } from '@internal/mongo-contract-psl/test';
import { mongoOrm } from '@internal/mongo-orm';
import { createMongoExecutionContext, createMongoExecutionStack } from '@internal/mongo-runtime';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { ObjectId } from 'mongodb';
import { expect, expectTypeOf, it } from 'vitest';
import { describeWithMongoDB } from './setup';

const applicationContract = defineContract({}, ({ field, model }) => ({
  models: {
    Post: model('Post', {
      collection: 'Post',
      fields: { id: field.objectId(), title: field.string(), updatedAt: field.date() },
    }),
  },
}));

function mappedContract() {
  const stack = createControlStack({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapter,
  });
  const bound = bindPslSchema(
    `model Post {
    id ObjectId @id @map("_id")
    title String
    updatedAt temporal.updatedAt() @map("updated_at")
  }`,
    {
      sourceId: 'mapped-fields.prisma',
      context: contractSourceContextFromControlStack(stack),
    },
  );
  expect(bound.seedDiagnostics).toEqual([]);
  const interpreted = interpretPslDocumentToMongoContract({
    documents: bound.documents,
    sources: bound.sources,
    symbolTable: bound.symbolTable,
    binder: bound.binder,
    ...mongoContextInput(bound.context),
  });
  if (!interpreted.ok) throw new Error(JSON.stringify(interpreted.failure));
  return interpreted.value as typeof applicationContract & {
    domain: {
      namespaces: {
        __unbound__: {
          models: {
            Post: {
              storage: { fields: { id: { field: '_id' }; updatedAt: { field: 'updated_at' } } };
            };
          };
        };
      };
    };
  };
}

describeWithMongoDB('Mongo mapped application fields', (ctx) => {
  it('writes and reads the model field name while storing only its mapped name', async () => {
    const contract = mappedContract();
    const mutationDefaults = createMongoExecutionContext({
      contract,
      stack: createMongoExecutionStack({
        target: mongoRuntimeTarget,
        adapter: mongoRuntimeAdapter,
      }),
    });
    const orm = mongoOrm({ contract, executor: ctx.runtime, mutationDefaults });
    const updatedAt = new Date('2025-01-02T03:04:05.000Z');
    const created = await orm.Post.create({ title: 'Mapped', updatedAt });
    expectTypeOf(created.updatedAt).toEqualTypeOf<Date>();
    expect(created).toEqual({ id: expect.any(String), title: 'Mapped', updatedAt });
    expectTypeOf(created.id).toEqualTypeOf<string>();
    expect(await orm.Post.where({ id: created.id }).first()).toEqual(created);
    expect(await orm.Post.where({ updatedAt }).first()).toEqual(created);
    expect(await orm.Post.orderBy({ updatedAt: 1 }).select('updatedAt').all().toArray()).toEqual([
      { updatedAt },
    ]);
    const replacement = new Date('2025-02-03T04:05:06.000Z');
    expect(await orm.Post.where({ updatedAt }).update({ updatedAt: replacement })).toEqual({
      ...created,
      updatedAt: replacement,
    });
    expect(
      await orm.Post.where({ id: created.id }).update((u) => [u.updatedAt.set(updatedAt)]),
    ).toEqual(created);
    expect(
      await orm.Post.where({ id: created.id }).updateAll({ updatedAt: replacement }).toArray(),
    ).toEqual([{ ...created, updatedAt: replacement }]);
    const stored = await ctx.client.db(ctx.dbName).collection('Post').aggregate([]).toArray();
    expect(stored).toEqual([
      { _id: expect.any(ObjectId), title: 'Mapped', updated_at: replacement },
    ]);
  });

  it('maps batch, default, upsert, and delete results while preserving mapped identity', async () => {
    const contract = mappedContract();
    const mutationDefaults = createMongoExecutionContext({
      contract,
      stack: createMongoExecutionStack({
        target: mongoRuntimeTarget,
        adapter: mongoRuntimeAdapter,
      }),
    });
    const orm = mongoOrm({ contract, executor: ctx.runtime, mutationDefaults });
    const updatedAt = new Date('2025-01-01');
    const [created] = await orm.Post.createAll([{ title: 'Batch', updatedAt }]).toArray();
    expect(created).toEqual({ id: expect.any(String), title: 'Batch', updatedAt });
    const inserted = await orm.Post.where({ title: 'Upsert' }).upsert({
      create: { title: 'Upsert', updatedAt },
      update: {},
    });
    expect(inserted).toEqual({ id: expect.any(String), title: 'Upsert', updatedAt });
    const changed = await orm.Post.where({ id: inserted.id }).upsert({
      create: { title: 'Unused', updatedAt },
      update: { title: 'Changed' },
    });
    expect(changed).toEqual({ id: inserted.id, title: 'Changed', updatedAt: expect.any(Date) });
    expect(changed.updatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
    expect(await orm.Post.where({ id: inserted.id }).delete()).toEqual(changed);
    const rows = await ctx.client.db(ctx.dbName).collection('Post').find().toArray();
    expect(rows).toEqual([{ _id: expect.any(ObjectId), title: 'Batch', updated_at: updatedAt }]);
    await expect(
      orm.Post.where({ title: 'Batch' }).update({ id: new ObjectId().toHexString() }),
    ).rejects.toThrow(/immutable|cannot modify/i);
  });
});
