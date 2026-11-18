import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  type AnnotationValue,
  assertAnnotationsApplicable,
  brandedAnnotations,
  defineAnnotation,
} from '../src/annotations';

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'test',
  lane: 'raw-sql',
};

function makePlan(annotations?: Record<string, unknown>): {
  readonly meta: { readonly annotations?: Record<string, unknown> };
} {
  if (annotations === undefined) {
    return { meta };
  }
  return { meta: { ...meta, annotations } };
}

describe('defineAnnotation', () => {
  describe('handle metadata', () => {
    it('exposes the namespace it was created with', () => {
      const handle = defineAnnotation<{ ttl: number }>()({
        namespace: 'cache',
        applicableTo: ['read'],
      });
      expect(handle.namespace).toBe('cache');
    });

    it('exposes a frozen ReadonlySet for applicableTo', () => {
      const handle = defineAnnotation<{ ttl: number }>()({
        namespace: 'otel',
        applicableTo: ['read', 'write'],
      });
      expect(handle.applicableTo.has('read')).toBe(true);
      expect(handle.applicableTo.has('write')).toBe(true);
      expect(Object.isFrozen(handle.applicableTo)).toBe(true);
    });

    it('handles do not share state across separate defineAnnotation calls', () => {
      const a = defineAnnotation<{ x: number }>()({
        namespace: 'a',
        applicableTo: ['read'],
      });
      const b = defineAnnotation<{ y: string }>()({
        namespace: 'b',
        applicableTo: ['write'],
      });
      expect(a.namespace).toBe('a');
      expect(b.namespace).toBe('b');
      expect(a.applicableTo.has('read')).toBe(true);
      expect(a.applicableTo.has('write' as 'read')).toBe(false);
      expect(b.applicableTo.has('write')).toBe(true);
    });
  });

  describe('value construction (calling the handle)', () => {
    it('produces an AnnotationValue carrying the __annotation brand', () => {
      const handle = defineAnnotation<{ ttl: number }>()({
        namespace: 'cache',
        applicableTo: ['read'],
      });
      const applied = handle({ ttl: 60 });
      expect(applied.__annotation).toBe(true);
    });

    it('embeds the namespace, payload, and applicableTo set on the value', () => {
      const handle = defineAnnotation<{ ttl: number }>()({
        namespace: 'cache',
        applicableTo: ['read'],
      });
      const applied = handle({ ttl: 60 });
      expect(applied.namespace).toBe('cache');
      expect(applied.value).toEqual({ ttl: 60 });
      expect(applied.applicableTo.has('read')).toBe(true);
    });

    it('produces a frozen value', () => {
      const handle = defineAnnotation<{ ttl: number }>()({
        namespace: 'cache',
        applicableTo: ['read'],
      });
      const applied = handle({ ttl: 60 });
      expect(Object.isFrozen(applied)).toBe(true);
    });

    it('produces independent values across repeated calls', () => {
      const handle = defineAnnotation<{ ttl: number }>()({
        namespace: 'cache',
        applicableTo: ['read'],
      });
      const a = handle({ ttl: 60 });
      const b = handle({ ttl: 120 });
      expect(a.value).toEqual({ ttl: 60 });
      expect(b.value).toEqual({ ttl: 120 });
    });
  });

  describe('read', () => {
    it('returns the payload when a value applied through the same handle is stored', () => {
      const handle = defineAnnotation<{ ttl: number }>()({
        namespace: 'cache',
        applicableTo: ['read'],
      });
      const applied = handle({ ttl: 60 });
      const plan = makePlan({ cache: applied });
      expect(handle.read(plan)).toEqual({ ttl: 60 });
    });

    it('returns undefined when the annotation is absent', () => {
      const handle = defineAnnotation<{ ttl: number }>()({
        namespace: 'cache',
        applicableTo: ['read'],
      });
      expect(handle.read(makePlan())).toBeUndefined();
      expect(handle.read(makePlan({}))).toBeUndefined();
      expect(handle.read(makePlan({ other: 'value' }))).toBeUndefined();
    });

    it('returns undefined when the stored value is not a branded AnnotationValue', () => {
      const handle = defineAnnotation<{ ttl: number }>()({
        namespace: 'cache',
        applicableTo: ['read'],
      });
      // Framework-internal metadata stored under the same namespace key
      // (e.g. the SQL emitter's meta.annotations.codecs map) is a raw
      // record, not a branded AnnotationValue. read() must not surface it
      // as a user annotation.
      expect(handle.read(makePlan({ cache: { ttl: 60 } }))).toBeUndefined();
      expect(handle.read(makePlan({ cache: 'string-value' }))).toBeUndefined();
      expect(handle.read(makePlan({ cache: 42 }))).toBeUndefined();
      expect(handle.read(makePlan({ cache: null }))).toBeUndefined();
    });

    it('two handles with different namespaces do not interfere', () => {
      const cache = defineAnnotation<{ ttl: number }>()({
        namespace: 'cache',
        applicableTo: ['read'],
      });
      const audit = defineAnnotation<{ actor: string }>()({
        namespace: 'audit',
        applicableTo: ['write'],
      });
      const plan = makePlan({
        cache: cache({ ttl: 60 }),
        audit: audit({ actor: 'system' }),
      });

      expect(cache.read(plan)).toEqual({ ttl: 60 });
      expect(audit.read(plan)).toEqual({ actor: 'system' });
    });

    it('read ignores annotations applied via a different handle even when the namespace string matches', () => {
      // Two handles claiming the same namespace string. Defensive:
      // read() compares the stored value's `namespace` field to the
      // handle's, so a value applied through one handle does not surface
      // through the other.
      const a = defineAnnotation<{ kind: 'a' }>()({
        namespace: 'shared',
        applicableTo: ['read'],
      });
      // Construct a value whose stored namespace differs from the
      // handle that reads it. (Both handles share a namespace string,
      // but the stored AnnotationValue.namespace would normally match
      // whichever handle wrote it.)
      const stored: AnnotationValue<{ kind: 'b' }, 'read'> = Object.freeze({
        __annotation: true as const,
        namespace: 'mismatched-namespace',
        value: { kind: 'b' as const },
        applicableTo: new Set<'read'>(['read']),
      });
      const plan = makePlan({ shared: stored });

      // The stored value's `namespace` field is 'mismatched-namespace',
      // which doesn't match the handle's 'shared' namespace. read()
      // returns undefined.
      expect(a.read(plan)).toBeUndefined();
    });

    it('preserves Payload identity (handle.read returns the same object reference stored)', () => {
      const handle = defineAnnotation<{ tags: string[] }>()({
        namespace: 'tags',
        applicableTo: ['read'],
      });
      const payload = { tags: ['admin', 'staff'] };
      const applied = handle(payload);
      const plan = makePlan({ tags: applied });

      const out = handle.read(plan);
      expect(out).toBe(payload);
    });

    it("reads an activity's annotations", () => {
      const cache = defineAnnotation<{ ttl: number }>()({
        namespace: 'cache',
        applicableTo: ['read'],
      });
      const audit = defineAnnotation<{ actor: string }>()({
        namespace: 'audit',
        applicableTo: ['write'],
      });
      const activity = { annotations: new Map([['cache', cache({ ttl: 60 })]]) };

      expect(cache.read(activity)).toEqual({ ttl: 60 });
      expect(audit.read(activity)).toBeUndefined();
    });
  });
});

describe('brandedAnnotations', () => {
  it('keeps only branded annotation values, keyed by namespace', () => {
    const cache = defineAnnotation<{ ttl: number }>()({
      namespace: 'cache',
      applicableTo: ['read'],
    });
    const applied = cache({ ttl: 60 });

    expect(brandedAnnotations({ cache: applied, codecs: { id: 'pg/int4@1' } })).toEqual(
      new Map([['cache', applied]]),
    );
  });

  it('is empty when the plan has no annotations', () => {
    expect(brandedAnnotations(undefined)).toEqual(new Map());
    expect(brandedAnnotations({ codecs: {} })).toEqual(new Map());
  });
});

describe('assertAnnotationsApplicable', () => {
  const cache = defineAnnotation<{ ttl: number }>()({
    namespace: 'cache',
    applicableTo: ['read'],
  });
  const audit = defineAnnotation<{ actor: string }>()({
    namespace: 'audit',
    applicableTo: ['write'],
  });
  const otel = defineAnnotation<{ traceId: string }>()({
    namespace: 'otel',
    applicableTo: ['read', 'write'],
  });

  describe('passes silently', () => {
    it('on an empty annotations array', () => {
      expect(() => assertAnnotationsApplicable([], 'read', 'first')).not.toThrow();
      expect(() => assertAnnotationsApplicable([], 'write', 'create')).not.toThrow();
    });

    it('when every annotation applies to the kind', () => {
      expect(() =>
        assertAnnotationsApplicable([cache({ ttl: 60 })], 'read', 'first'),
      ).not.toThrow();
      expect(() =>
        assertAnnotationsApplicable([audit({ actor: 'a' })], 'write', 'create'),
      ).not.toThrow();
    });

    it('when an annotation declares both kinds and is used on either', () => {
      expect(() =>
        assertAnnotationsApplicable([otel({ traceId: 't' })], 'read', 'first'),
      ).not.toThrow();
      expect(() =>
        assertAnnotationsApplicable([otel({ traceId: 't' })], 'write', 'create'),
      ).not.toThrow();
    });

    it('when multiple compatible annotations are passed together', () => {
      expect(() =>
        assertAnnotationsApplicable([cache({ ttl: 60 }), otel({ traceId: 't' })], 'read', 'first'),
      ).not.toThrow();
    });
  });

  describe('throws RUNTIME.ANNOTATION_INAPPLICABLE', () => {
    it('on a read-only annotation passed to a write terminal', () => {
      expect(() => assertAnnotationsApplicable([cache({ ttl: 60 })], 'write', 'create')).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
          category: 'RUNTIME',
        }),
      );
    });

    it('on a write-only annotation passed to a read terminal', () => {
      expect(() =>
        assertAnnotationsApplicable([audit({ actor: 'system' })], 'read', 'first'),
      ).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
          category: 'RUNTIME',
        }),
      );
    });

    it('on the first inapplicable annotation when several are passed', () => {
      expect(() =>
        assertAnnotationsApplicable(
          [otel({ traceId: 't' }), audit({ actor: 'system' })],
          'read',
          'first',
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
        }),
      );
    });

    it('with a message that says what to do, in terms the caller wrote', () => {
      expect(() =>
        assertAnnotationsApplicable([audit({ actor: 'system' })], 'read', 'first'),
      ).toThrow(
        expect.objectContaining({
          message:
            'An annotation that applies only to write operations was given to a read operation. Remove it from the read and put it on a write operation instead.',
        }),
      );
    });

    it('without a fix field', () => {
      expect(() =>
        assertAnnotationsApplicable([audit({ actor: 'system' })], 'read', 'first'),
      ).toThrow(expect.not.objectContaining({ fix: expect.anything() }));
    });

    it('with structured details including namespace, terminalName, kind, and applicableTo', () => {
      try {
        assertAnnotationsApplicable([cache({ ttl: 60 })], 'write', 'create');
        expect.fail('expected assertAnnotationsApplicable to throw');
      } catch (error) {
        const envelope = error as Error & { details?: Record<string, unknown> };
        expect(envelope.details).toEqual({
          namespace: 'cache',
          terminalName: 'create',
          kind: 'write',
          applicableTo: ['read'],
        });
      }
    });
  });
});
