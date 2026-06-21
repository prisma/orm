import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { type CachePayload, cacheAnnotation } from '../src/cache-annotation';

const baseMeta: PlanMeta = {
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: 'test',
  lane: 'orm',
};

function planWith(annotations: Record<string, unknown>): { readonly meta: PlanMeta } {
  return { meta: { ...baseMeta, annotations } };
}

describe('cacheAnnotation handle', () => {
  it('declares namespace "cache"', () => {
    expect(cacheAnnotation.namespace).toBe('cache');
  });

  it('declares applicableTo = ["read"]', () => {
    expect(Array.from(cacheAnnotation.applicableTo)).toEqual(['read']);
  });

  it('produces an applied annotation under namespace "cache" carrying the payload', () => {
    const applied = cacheAnnotation({ ttl: 60 });

    expect(applied.namespace).toBe('cache');
    expect(applied.value).toEqual({ ttl: 60 });
    expect(Array.from(applied.applicableTo)).toEqual(['read']);
  });

  it('round-trips a payload via call -> read on a plan', () => {
    const applied = cacheAnnotation({ ttl: 60 });
    const plan = planWith({ cache: applied });

    const recovered = cacheAnnotation.read(plan);
    expect(recovered).toEqual({ ttl: 60 });
  });

  it('returns undefined when reading a plan without a cache annotation', () => {
    const plan = planWith({});
    expect(cacheAnnotation.read(plan)).toBeUndefined();
  });

  it('returns undefined when the plan has no annotations bag at all', () => {
    const plan: { readonly meta: PlanMeta } = { meta: baseMeta };
    expect(cacheAnnotation.read(plan)).toBeUndefined();
  });

  it('preserves all CachePayload fields (enabled, ttl, skip, key, namespace, dedupe, tags, store)', () => {
    const payload: CachePayload = {
      enabled: true,
      ttl: 120,
      skip: false,
      key: 'custom-key',
      namespace: 'tenant-a',
      dedupe: true,
      tags: ['users', 'tenant-a'],
      store: 'primary',
    };
    const applied = cacheAnnotation(payload);
    const plan = planWith({ cache: applied });

    expect(cacheAnnotation.read(plan)).toEqual(payload);
  });

  it('accepts an empty payload', () => {
    const applied = cacheAnnotation({});
    const plan = planWith({ cache: applied });

    expect(cacheAnnotation.read(plan)).toEqual({});
  });
});
