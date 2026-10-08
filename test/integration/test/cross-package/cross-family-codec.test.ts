import { newMongoCodecRegistry } from '@internal/mongo-codec';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { resolveValue } from '../../../../packages/3-mongo-target/2-mongo-adapter/src/resolve-value';
import { defineTestCodec } from './test-codec';

// T4.1 — cross-family codec parity proof
//
// A single codec instance (constructed via the test-only `defineTestCodec` helper, which mirrors the shape of an author-side codec definition) is used directly on the SQL side and registered in a Mongo `MongoCodecRegistry`. Encoding the same input value through each path must produce identical wire output. For the SQL fixture the same codec also round-trips via `decode`, demonstrating that one codec definition can
// serve both directional boundaries.

describe('cross-family codec parity (T4.1)', () => {
  // A single codec instance — used on the SQL side directly and registered in the Mongo registry.
  const objectIdLikeCodec = defineTestCodec({
    typeId: 'shared/object-id-like@1',
    toWire: (value: string) => `wire:${value}`,
    fromWire: (wire: string) => wire.replace(/^wire:/, ''),
  });

  it('produces identical wire output through both family code paths', async () => {
    const mongoRegistry = newMongoCodecRegistry();
    mongoRegistry.register(objectIdLikeCodec);

    const mongoCodecLookup = mongoRegistry.get('shared/object-id-like@1');
    if (!mongoCodecLookup) {
      throw new Error('codec not registered in mongo registry');
    }

    const sqlWire = await objectIdLikeCodec.toWire('abc-123', {});
    const mongoWire = await mongoCodecLookup.toWire('abc-123', {});

    expect(sqlWire).toBe('wire:abc-123');
    expect(mongoWire).toBe('wire:abc-123');
    expect(sqlWire).toEqual(mongoWire);
  });

  it('encoding through Mongo resolveValue matches SQL codec.encode result', async () => {
    const mongoRegistry = newMongoCodecRegistry();
    mongoRegistry.register(objectIdLikeCodec);

    const sqlWire = await objectIdLikeCodec.toWire('abc-123', {});
    const mongoWire = await resolveValue(
      new MongoParamRef('abc-123', { codecId: 'shared/object-id-like@1' }),
      mongoRegistry,
      {},
    );

    expect(mongoWire).toBe('wire:abc-123');
    expect(sqlWire).toEqual(mongoWire);
  });

  it('round-trips: SQL decode is the inverse of SQL encode', async () => {
    const wire = await objectIdLikeCodec.toWire('abc-123', {});
    expect(wire).toBe('wire:abc-123');

    const decoded = await objectIdLikeCodec.fromWire(wire, {});
    expect(decoded).toBe('abc-123');
  });
});
