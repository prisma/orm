import type { PlanMeta } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import {
  type UncacheAction,
  type UncachePayload,
  uncacheAnnotation,
} from '../src/uncache-annotation';

const baseMeta: PlanMeta = {
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: 'sha256:test',
  lane: 'orm',
};

function planWith(annotations: Record<string, unknown>): { readonly meta: PlanMeta } {
  return { meta: { ...baseMeta, annotations } };
}

describe('uncacheAnnotation handle', () => {
  it('declares namespace "uncache"', () => {
    expect(uncacheAnnotation.namespace).toBe('uncache');
  });

  it('declares applicableTo = ["write"]', () => {
    expect(Array.from(uncacheAnnotation.applicableTo)).toEqual(['write']);
  });

  it('round-trips payload from call to read()', () => {
    const payload: UncachePayload = { enabled: true, namespace: 'tenant-a' };
    const plan = planWith({ uncache: uncacheAnnotation(payload) });
    expect(uncacheAnnotation.read(plan)).toEqual(payload);
  });

  it('round-trips payload with uncache array', () => {
    const uncache: readonly UncacheAction[] = [
      { namespace: 'users', keys: ['user:1'] },
      { namespace: 'posts', models: ['posts'] },
    ];
    const payload: UncachePayload = { uncache };
    const plan = planWith({ uncache: uncacheAnnotation(payload) });
    expect(uncacheAnnotation.read(plan)).toEqual(payload);
  });

  it('returns undefined when annotation is absent', () => {
    expect(uncacheAnnotation.read(planWith({}))).toBeUndefined();
  });
});
