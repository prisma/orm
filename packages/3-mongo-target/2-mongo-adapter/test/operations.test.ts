import { createOperationRegistry } from '@internal/operations';
import { MONGO_VECTOR_CODEC_ID } from '@internal/target-mongo/codec-ids';
import { describe, expect, it } from 'vitest';
import { mongoVectorNearOperation, mongoVectorOperationDescriptors } from '../src/core/operations';

describe('vector operation descriptors (production-defined)', () => {
  it('mongoVectorNearOperation targets the vector codec', () => {
    expect(mongoVectorNearOperation.self?.codecId).toBe(MONGO_VECTOR_CODEC_ID);
  });

  it('mongoVectorNearOperation.impl returns undefined as a placeholder', () => {
    // Mongo does not yet lower the vector `near` operation; the impl is a placeholder so the descriptor satisfies the shared shape.
    expect((mongoVectorNearOperation.impl as () => unknown)()).toBeUndefined();
  });

  it('mongoVectorOperationDescriptors includes near', () => {
    expect(Object.keys(mongoVectorOperationDescriptors)).toEqual(['near']);
    expect(mongoVectorOperationDescriptors['near']).toBe(mongoVectorNearOperation);
  });

  it('registers production-defined operations in registry', () => {
    const registry = createOperationRegistry();
    for (const [name, op] of Object.entries(mongoVectorOperationDescriptors)) {
      registry.register(name, op);
    }

    const entries = registry.entries();
    expect(entries['near']).toBeDefined();
    expect(entries['near']?.self?.codecId).toBe(MONGO_VECTOR_CODEC_ID);
  });

  it('returns empty entries for fresh registry', () => {
    const registry = createOperationRegistry();
    expect(Object.keys(registry.entries())).toHaveLength(0);
  });
});
