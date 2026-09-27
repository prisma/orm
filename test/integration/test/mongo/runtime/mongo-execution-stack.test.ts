import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import { isRuntimeError } from '@internal/framework-components/runtime';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  type MongoExecutionContext,
  type MongoRuntimeExtensionDescriptor,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';

const STANDARD_CODEC_IDS = [
  'mongo/objectId@1',
  'mongo/string@1',
  'mongo/double@1',
  'mongo/int32@1',
  'mongo/bool@1',
  'mongo/date@1',
  'mongo/vector@1',
  'mongo/int64@1',
  'mongo/decimal128@1',
  'mongo/binary@1',
  'mongo/json@1',
];

describe('createMongoExecutionStack', () => {
  it('builds a stack from target + adapter (no extensions, no driver)', () => {
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    expect(stack.target).toBe(mongoRuntimeTarget);
    expect(stack.adapter).toBe(mongoRuntimeAdapter);
    expect(stack.driver).toBeUndefined();
    expect(stack.extensions).toEqual([]);
  });

  it('exposes the supplied extension packs', () => {
    const pack: MongoRuntimeExtensionDescriptor<'mongo'> = {
      kind: 'extension',
      id: 'test-pack',
      familyId: 'mongo',
      targetId: 'mongo',
      version: '0.0.1',
      codecs: () => newMongoCodecRegistry(),
      create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
    };
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
      extensions: [pack],
    });
    expect(stack.extensions).toEqual([pack]);
  });
});

describe('createMongoExecutionContext', () => {
  it('aggregates the standard wire-type codecs from the adapter descriptor', () => {
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const context = createMongoExecutionContext({ contract: {}, stack });
    for (const id of STANDARD_CODEC_IDS) {
      expect(context.codecs.get(id), `codec ${id} should be registered`).toBeDefined();
    }
  });

  it('folds extension-pack codec contributions into the same registry', () => {
    const customCodec = mongoCodec({
      typeId: 'test/custom@1',
      decode: (wire: string) => `decoded:${wire}`,
      encode: (value: string) => value,
    });
    const pack: MongoRuntimeExtensionDescriptor<'mongo'> = {
      kind: 'extension',
      id: 'extension-with-codec',
      familyId: 'mongo',
      targetId: 'mongo',
      version: '0.0.1',
      codecs: () => {
        const registry = newMongoCodecRegistry();
        registry.register(customCodec);
        return registry;
      },
      create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
    };
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
      extensions: [pack],
    });
    const context = createMongoExecutionContext({ contract: {}, stack });
    expect(context.codecs.get('test/custom@1')).toBe(customCodec);
    expect(context.codecs.get('mongo/string@1')).toBeDefined();
  });

  it('throws RUNTIME.DUPLICATE_CODEC when two contributors declare the same codec id', () => {
    const conflictingCodec = mongoCodec({
      typeId: 'mongo/string@1',
      decode: (wire: string) => wire,
      encode: (value: string) => value,
    });
    const conflictingPack: MongoRuntimeExtensionDescriptor<'mongo'> = {
      kind: 'extension',
      id: 'extension-string-conflict',
      familyId: 'mongo',
      targetId: 'mongo',
      version: '0.0.1',
      codecs: () => {
        const registry = newMongoCodecRegistry();
        registry.register(conflictingCodec);
        return registry;
      },
      create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
    };
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
      extensions: [conflictingPack],
    });

    let caught: unknown;
    try {
      createMongoExecutionContext({ contract: {}, stack });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    if (!isRuntimeError(caught)) throw new Error('expected runtime error');
    expect(caught.code).toBe('RUNTIME.DUPLICATE_CODEC');
    expect(caught.message).toContain('mongo/string@1');
    expect(caught.message).toContain('extension-string-conflict');
    expect(caught.message).toContain('mongo');
    expect(caught.details).toMatchObject({
      codecId: 'mongo/string@1',
      existingOwner: 'mongo',
      incomingOwner: 'extension-string-conflict',
    });
  });

  it('returns a frozen { contract, codecs, stack } object', () => {
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const contract = { models: {} };
    const context = createMongoExecutionContext({ contract, stack });
    expect(Object.isFrozen(context)).toBe(true);
    expect(context.contract).toBe(contract);
    expect(context.stack).toBe(stack);
  });

  it('preserves the TContract type on context.contract (no unknown widening)', () => {
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const contract = { target: 'mongo' as const, storageHash: 'test' };
    const context = createMongoExecutionContext({ contract, stack });
    expectTypeOf(context).toMatchTypeOf<MongoExecutionContext<typeof contract>>();
    expectTypeOf(context.contract).toEqualTypeOf<typeof contract>();
  });
});

describe('runtime adapter descriptor', () => {
  it('surfaces the standard Mongo codecs through its codecs() registry', () => {
    const codecIds = [...mongoRuntimeAdapter.codecs()].map((codec) => codec.id).sort();
    expect(codecIds).toEqual([...STANDARD_CODEC_IDS].sort());
  });

  it('create(stack) returns an instance whose lower() delegates to the standard adapter', async () => {
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const adapterInstance = mongoRuntimeAdapter.create(stack);
    expect(adapterInstance.familyId).toBe('mongo');
    expect(adapterInstance.targetId).toBe('mongo');
    expect(typeof adapterInstance.lower).toBe('function');
  });
});
