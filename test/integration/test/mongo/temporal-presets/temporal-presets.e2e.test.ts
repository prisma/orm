import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import mongo from '@internal/mongo/runtime';
import { newMongoCodecRegistry } from '@internal/mongo-codec';
import type { CreateInput } from '@internal/mongo-orm';
import { createMongoExecutionContext, createMongoExecutionStack } from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const touchedAt = new Date('2020-01-01T00:00:00Z');

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe('Mongo temporal presets end to end', () => {
  it(
    'creates without timestamps; both fields are stored and read back as one Date',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const created = await db.posts.create({ title: 'a', touchedAt });
        expect(created.createdAt).toBeInstanceOf(Date);
        expect(created.updated_at).toEqual(created.createdAt);

        const stored = await mongoDb.collection('posts').findOne({ title: 'a' });
        expect(stored?.['createdAt']).toBeInstanceOf(Date);
        expect(stored?.['updated_at']).toEqual(stored?.['createdAt']);

        const read = await db.posts.where({ title: 'a' }).first();
        expect(read?.createdAt).toEqual(created.createdAt);
        expect(read?.updated_at).toBeInstanceOf(Date);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'createAll shares one timestamp across documents',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const rows = await db.posts
          .createAll([
            { title: 'a', touchedAt },
            { title: 'b', touchedAt },
          ])
          .toArray();
        expect(rows[1]?.createdAt).toEqual(rows[0]?.createdAt);
        expect(rows[1]?.updated_at).toEqual(rows[0]?.createdAt);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'update with a payload advances updated_at and touchedAt but not createdAt',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.posts.create({ title: 'a', touchedAt });
        await tick();
        const updated = await db.posts.where({ title: 'a' }).update({ title: 'b' });
        expect(updated?.createdAt).toEqual(created.createdAt);
        expect(updated?.updated_at.getTime()).toBeGreaterThan(created.updated_at.getTime());
        expect(updated?.touchedAt.getTime()).toBeGreaterThan(touchedAt.getTime());
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'update with an empty payload advances nothing',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.posts.create({ title: 'a', touchedAt });
        await tick();
        const updated = await db.posts.where({ title: 'a' }).update({});
        expect(updated?.updated_at).toEqual(created.updated_at);
        expect(updated?.touchedAt).toEqual(touchedAt);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'an explicit updated_at on create wins',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const explicit = new Date('2021-06-01T00:00:00Z');
        await db.posts.create({ title: 'a', touchedAt, updated_at: explicit });
        const stored = await mongoDb.collection('posts').findOne({ title: 'a' });
        expect(stored?.['updated_at']).toEqual(explicit);
        expect(stored?.['createdAt']).toBeInstanceOf(Date);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'upsert fills the insert half, then advances only updated_at on the update half',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const inserted = await db.posts
          .where({ title: 'a' })
          .upsert({ create: { title: 'a', touchedAt }, update: {} });
        expect(inserted.createdAt).toBeInstanceOf(Date);
        expect(inserted.updated_at).toEqual(inserted.createdAt);
        await tick();
        const updated = await db.posts
          .where({ title: 'a' })
          .upsert({ create: { title: 'a', touchedAt }, update: { title: 'a' } });
        expect(updated.createdAt).toEqual(inserted.createdAt);
        expect(updated.updated_at.getTime()).toBeGreaterThan(inserted.updated_at.getTime());
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'mongo() fills generated fields through the facade',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ client, mongoDb }) => {
        const facade = mongo<Contract>({
          contractJson,
          mongoClient: client,
          dbName: mongoDb.databaseName,
        });
        try {
          const created = await facade.orm.posts.create({ title: 'a', touchedAt });
          expect(created.createdAt).toBeInstanceOf(Date);
        } finally {
          await facade.close();
        }
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'a preset on a polymorphic base model fills every variant create',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const click = await db.events.variant('Click').create({ url: '/a' });
        const view = await db.events.variant('View').create({ path: '/b' });
        expect(click.createdAt).toBeInstanceOf(Date);
        expect(view.createdAt).toBeInstanceOf(Date);

        const stored = await mongoDb.collection('events').find({}).sort({ kind: 1 }).toArray();
        expect(stored).toEqual([
          expect.objectContaining({ kind: 'click', url: '/a', createdAt: click.createdAt }),
          expect.objectContaining({ kind: 'view', path: '/b', createdAt: view.createdAt }),
        ]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it('types generated-on-create fields as optional on the emitted create input', () => {
    type PostCreate = CreateInput<Contract, 'Post'>;
    expectTypeOf<{ title: string; touchedAt: Date }>().toExtend<PostCreate>();
    expectTypeOf<{ title: string }>().not.toExtend<PostCreate>();
  });
});

describe('Mongo mutation default generator registration', () => {
  const contract = JSON.parse(JSON.stringify(contractJson)) as unknown;

  it('throws RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING when no component provides timestampNow', () => {
    const { mutationDefaultGenerators: _, ...adapterWithoutGenerators } = mongoRuntimeAdapter;
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: adapterWithoutGenerators,
    });
    expect(() => createMongoExecutionContext({ contract, stack })).toThrow(
      expect.objectContaining({ code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING' }),
    );
  });

  it('throws RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR when two components provide timestampNow', () => {
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
      extensions: [
        {
          kind: 'extension',
          id: 'second-clock',
          familyId: 'mongo',
          targetId: 'mongo',
          version: '0.0.1',
          codecs: () => newMongoCodecRegistry(),
          mutationDefaultGenerators: () => [
            { id: 'timestampNow', generate: () => new Date(0), stability: 'query' },
          ],
          create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
        },
      ],
    });
    expect(() => createMongoExecutionContext({ contract, stack })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR',
        details: expect.objectContaining({ existingOwner: 'mongo', incomingOwner: 'second-clock' }),
      }),
    );
  });
});
