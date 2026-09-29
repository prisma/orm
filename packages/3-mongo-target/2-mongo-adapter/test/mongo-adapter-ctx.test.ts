import { type CodecCallContext, decodeJsonString } from '@internal/framework-components/codec';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import {
  AggregateCommand,
  DeleteOneCommand,
  FindOneAndUpdateCommand,
  InsertManyCommand,
  InsertOneCommand,
  MongoFieldFilter,
  MongoMatchStage,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { _unstable_createMongoAdapterWithCodecs } from '../src/mongo-adapter';

const baseMeta = {
  target: 'mongo' as const,
  storageHash: 'test',
  lane: 'mongo' as const,
  paramDescriptors: [],
};

function recordingRegistry(observed: (CodecCallContext | undefined)[]) {
  const registry = newMongoCodecRegistry();
  registry.register(
    mongoCodec({
      typeId: 'test/recorder@1',
      decode: (w: string) => w,
      encode: (v: string, ctx?: CodecCallContext) => {
        observed.push(ctx);
        return v;
      },
      decodeJson: (json) => decodeJsonString('test/recorder@1', json),
    }),
  );
  return registry;
}

describe('MongoAdapter — CodecCallContext threading', () => {
  it('forwards the same ctx instance from lower(plan, ctx) into resolveValue (insertOne)', async () => {
    const observed: (CodecCallContext | undefined)[] = [];
    const adapter = _unstable_createMongoAdapterWithCodecs(recordingRegistry(observed));
    const ctx: CodecCallContext = { signal: new AbortController().signal };

    await adapter.lower(
      {
        collection: 'users',
        command: new InsertOneCommand('users', {
          name: new MongoParamRef('alice', { codecId: 'test/recorder@1' }),
        }),
        meta: baseMeta,
      },
      ctx,
    );

    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(ctx);
  });

  it('preserves ctx identity across all insertMany leaves (every doc + every leaf)', async () => {
    const observed: (CodecCallContext | undefined)[] = [];
    const adapter = _unstable_createMongoAdapterWithCodecs(recordingRegistry(observed));
    const ctx: CodecCallContext = { signal: new AbortController().signal };

    await adapter.lower(
      {
        collection: 'users',
        command: new InsertManyCommand('users', [
          { name: new MongoParamRef('a', { codecId: 'test/recorder@1' }) },
          { name: new MongoParamRef('b', { codecId: 'test/recorder@1' }) },
        ]),
        meta: baseMeta,
      },
      ctx,
    );

    expect(observed).toHaveLength(2);
    for (const seen of observed) {
      expect(seen).toBe(ctx);
    }
  });

  it('threads ctx through both lowerFilter and #lowerUpdate (updateOne)', async () => {
    const observed: (CodecCallContext | undefined)[] = [];
    const adapter = _unstable_createMongoAdapterWithCodecs(recordingRegistry(observed));
    const ctx: CodecCallContext = { signal: new AbortController().signal };

    await adapter.lower(
      {
        collection: 'users',
        command: new UpdateOneCommand(
          'users',
          MongoFieldFilter.eq('name', new MongoParamRef('alice', { codecId: 'test/recorder@1' })),
          { $set: { age: new MongoParamRef('30', { codecId: 'test/recorder@1' }) } },
        ),
        meta: baseMeta,
      },
      ctx,
    );

    expect(observed).toHaveLength(2);
    for (const seen of observed) {
      expect(seen).toBe(ctx);
    }
  });

  it('threads ctx through deleteOne lowerFilter', async () => {
    const observed: (CodecCallContext | undefined)[] = [];
    const adapter = _unstable_createMongoAdapterWithCodecs(recordingRegistry(observed));
    const ctx: CodecCallContext = { signal: new AbortController().signal };

    await adapter.lower(
      {
        collection: 'users',
        command: new DeleteOneCommand(
          'users',
          MongoFieldFilter.eq('name', new MongoParamRef('alice', { codecId: 'test/recorder@1' })),
        ),
        meta: baseMeta,
      },
      ctx,
    );

    expect(observed).toEqual([ctx]);
  });

  it('threads ctx through findOneAndUpdate (filter + update)', async () => {
    const observed: (CodecCallContext | undefined)[] = [];
    const adapter = _unstable_createMongoAdapterWithCodecs(recordingRegistry(observed));
    const ctx: CodecCallContext = { signal: new AbortController().signal };

    await adapter.lower(
      {
        collection: 'users',
        command: new FindOneAndUpdateCommand(
          'users',
          MongoFieldFilter.eq('id', new MongoParamRef('1', { codecId: 'test/recorder@1' })),
          { $set: { v: new MongoParamRef('x', { codecId: 'test/recorder@1' }) } },
        ),
        meta: baseMeta,
      },
      ctx,
    );

    expect(observed).toHaveLength(2);
    for (const seen of observed) {
      expect(seen).toBe(ctx);
    }
  });

  it('threads ctx through aggregate $match stages (lowerPipeline → lowerStage → lowerFilter)', async () => {
    const observed: (CodecCallContext | undefined)[] = [];
    const adapter = _unstable_createMongoAdapterWithCodecs(recordingRegistry(observed));
    const ctx: CodecCallContext = { signal: new AbortController().signal };

    await adapter.lower(
      {
        collection: 'users',
        command: new AggregateCommand('users', [
          new MongoMatchStage(
            MongoFieldFilter.eq('name', new MongoParamRef('alice', { codecId: 'test/recorder@1' })),
          ),
        ]),
        meta: baseMeta,
      },
      ctx,
    );

    expect(observed).toEqual([ctx]);
  });

  it('threading an empty ctx forwards that same empty ctx to the codec', async () => {
    const observed: (CodecCallContext | undefined)[] = [];
    const adapter = _unstable_createMongoAdapterWithCodecs(recordingRegistry(observed));
    const ctx: CodecCallContext = {};

    await adapter.lower(
      {
        collection: 'users',
        command: new InsertOneCommand('users', {
          name: new MongoParamRef('alice', { codecId: 'test/recorder@1' }),
        }),
        meta: baseMeta,
      },
      ctx,
    );

    expect(observed).toEqual([ctx]);
  });

  it('already-aborted ctx surfaces RUNTIME.ABORTED { phase: encode } from inside resolveValue (no codec call)', async () => {
    let callCount = 0;
    const adapter = _unstable_createMongoAdapterWithCodecs(
      (() => {
        const reg = newMongoCodecRegistry();
        reg.register(
          mongoCodec({
            typeId: 'test/counter@1',
            decode: (w: string) => w,
            encode: (v: string) => {
              callCount += 1;
              return v;
            },
            decodeJson: (json) => decodeJsonString('test/counter@1', json),
          }),
        );
        return reg;
      })(),
    );

    const controller = new AbortController();
    const reason = new Error('already aborted at adapter boundary');
    controller.abort(reason);

    await expect(
      adapter.lower(
        {
          collection: 'users',
          command: new InsertOneCommand('users', {
            name: new MongoParamRef('alice', { codecId: 'test/counter@1' }),
          }),
          meta: baseMeta,
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'encode' },
      cause: reason,
    });
    expect(callCount).toBe(0);
  });
});
