import { describe, expect, it } from 'vitest';
import { defineAnnotation } from '../src/annotations';
import { createMetaBuilder } from '../src/meta-builder';

const cacheAnnotation = defineAnnotation<{ ttl: number }>()({
  namespace: 'cache',
  applicableTo: ['read'],
});

const auditAnnotation = defineAnnotation<{ actor: string }>()({
  namespace: 'audit',
  applicableTo: ['write'],
});

const otelAnnotation = defineAnnotation<{ traceId: string }>()({
  namespace: 'otel',
  applicableTo: ['read', 'write'],
});

describe('createMetaBuilder', () => {
  it('starts with an empty annotations map', () => {
    const meta = createMetaBuilder('read', 'all');
    expect(meta.annotations.size).toBe(0);
  });

  it('records an applied annotation under its namespace', () => {
    const meta = createMetaBuilder('read', 'all');
    meta.annotate(cacheAnnotation({ ttl: 60 }));
    expect(meta.annotations.size).toBe(1);
    expect(meta.annotations.get('cache')?.value).toEqual({ ttl: 60 });
  });

  it('annotate returns the builder for chaining', () => {
    const meta = createMetaBuilder('read', 'all');
    const chained = meta
      .annotate(cacheAnnotation({ ttl: 60 }))
      .annotate(otelAnnotation({ traceId: 't-1' }));
    expect(chained).toBe(meta);
    expect(meta.annotations.size).toBe(2);
  });

  it('last-write-wins on duplicate namespaces', () => {
    const meta = createMetaBuilder('read', 'all');
    meta.annotate(cacheAnnotation({ ttl: 60 }));
    meta.annotate(cacheAnnotation({ ttl: 120 }));
    expect(meta.annotations.size).toBe(1);
    expect(meta.annotations.get('cache')?.value).toEqual({ ttl: 120 });
  });

  it('a both-kind annotation lands on a read builder', () => {
    const meta = createMetaBuilder('read', 'all');
    meta.annotate(otelAnnotation({ traceId: 't-1' }));
    expect(meta.annotations.get('otel')?.value).toEqual({ traceId: 't-1' });
  });

  it('a both-kind annotation lands on a write builder', () => {
    const meta = createMetaBuilder('write', 'create');
    meta.annotate(otelAnnotation({ traceId: 't-1' }));
    expect(meta.annotations.get('otel')?.value).toEqual({ traceId: 't-1' });
  });

  it('runtime gate rejects a write-only annotation forced through a cast on a read builder', () => {
    const meta = createMetaBuilder('read', 'all');
    const annotateAny = meta.annotate as (annotation: unknown) => unknown;
    expect(() => annotateAny.call(meta, auditAnnotation({ actor: 'system' }))).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
        category: 'RUNTIME',
      }),
    );
  });

  it('runtime gate names the offending namespace and terminal in the error', () => {
    const meta = createMetaBuilder('write', 'create');
    const annotateAny = meta.annotate as (annotation: unknown) => unknown;
    try {
      annotateAny.call(meta, cacheAnnotation({ ttl: 60 }));
    } catch (error) {
      expect(error).toMatchObject({
        code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
        details: {
          namespace: 'cache',
          terminalName: 'create',
          kind: 'write',
        },
      });
      return;
    }
    throw new Error('expected runtime gate to throw');
  });

  it('rejected annotations are not recorded', () => {
    const meta = createMetaBuilder('read', 'all');
    const annotateAny = meta.annotate as (annotation: unknown) => unknown;
    try {
      annotateAny.call(meta, auditAnnotation({ actor: 'system' }));
    } catch {
      // expected
    }
    expect(meta.annotations.size).toBe(0);
  });
});
