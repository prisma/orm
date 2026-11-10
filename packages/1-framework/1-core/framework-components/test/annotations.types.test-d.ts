import { assertType, describe, expectTypeOf, test } from 'vitest';
import {
  type AnnotationHandle,
  type AnnotationValue,
  defineAnnotation,
  type OperationKind,
  type ValidAnnotations,
} from '../src/annotations';

/**
 * Type-level tests for the annotation surface.
 *
 * Verifies:
 *  - `defineAnnotation<P, Kinds>` preserves Payload and Kinds in the
 *    handle's static type and across `apply` / `read`.
 *  - `ValidAnnotations<K, As>` resolves matching tuple elements to live
 *    `AnnotationValue` types and mismatched elements to `never` (which
 *    makes the entire tuple unassignable, which is the failure mode lane
 *    terminals exploit at the type level).
 *  - Lane-terminal call shapes — read terminals accepting read-only
 *    annotations, write terminals rejecting them, both-kind annotations
 *    accepted everywhere — work as expected.
 */

const readOnly = defineAnnotation<{ ttl: number }>()({
  namespace: 'cache',
  applicableTo: ['read'],
});

const writeOnly = defineAnnotation<{ actor: string }>()({
  namespace: 'audit',
  applicableTo: ['write'],
});

const both = defineAnnotation<{ traceId: string }>()({
  namespace: 'otel',
  applicableTo: ['read', 'write'],
});

describe('defineAnnotation generics', () => {
  test('defineAnnotation preserves Payload and Kinds in the handle type', () => {
    expectTypeOf(readOnly).toEqualTypeOf<AnnotationHandle<{ ttl: number }, 'read'>>();
    expectTypeOf(writeOnly).toEqualTypeOf<AnnotationHandle<{ actor: string }, 'write'>>();
    expectTypeOf(both).toEqualTypeOf<AnnotationHandle<{ traceId: string }, 'read' | 'write'>>();
  });

  test('AnnotationHandle.applicableTo is a ReadonlySet narrowed to the declared Kinds', () => {
    expectTypeOf(readOnly.applicableTo).toEqualTypeOf<ReadonlySet<'read'>>();
    expectTypeOf(writeOnly.applicableTo).toEqualTypeOf<ReadonlySet<'write'>>();
    expectTypeOf(both.applicableTo).toEqualTypeOf<ReadonlySet<'read' | 'write'>>();
  });

  test('calling the handle preserves Payload and Kinds in the AnnotationValue', () => {
    const r = readOnly({ ttl: 60 });
    const w = writeOnly({ actor: 'system' });
    const x = both({ traceId: 't' });

    expectTypeOf(r).toEqualTypeOf<AnnotationValue<{ ttl: number }, 'read'>>();
    expectTypeOf(w).toEqualTypeOf<AnnotationValue<{ actor: string }, 'write'>>();
    expectTypeOf(x).toEqualTypeOf<AnnotationValue<{ traceId: string }, 'read' | 'write'>>();
  });

  test('handle call rejects payloads of the wrong shape (negative)', () => {
    // @ts-expect-error - missing required `ttl` field
    readOnly({});
    // @ts-expect-error - wrong field name
    readOnly({ wrong: 60 });
    // @ts-expect-error - wrong field type
    readOnly({ ttl: 'not a number' });
  });

  test('read returns Payload | undefined', () => {
    const plan: { readonly meta: { readonly annotations?: Record<string, unknown> } } = {
      meta: {},
    };
    const out = readOnly.read(plan);
    expectTypeOf(out).toEqualTypeOf<{ ttl: number } | undefined>();
  });
});

describe('ValidAnnotations gate', () => {
  test("ValidAnnotations<'read', [readOnly]> keeps the element typed", () => {
    type As = readonly [AnnotationValue<{ ttl: number }, 'read'>];
    type Gated = ValidAnnotations<'read', As>;
    expectTypeOf<Gated>().toEqualTypeOf<readonly [AnnotationValue<{ ttl: number }, 'read'>]>();
  });

  test("ValidAnnotations<'read', [writeOnly]> resolves the element to never", () => {
    type As = readonly [AnnotationValue<{ actor: string }, 'write'>];
    type Gated = ValidAnnotations<'read', As>;
    expectTypeOf<Gated>().toEqualTypeOf<readonly [never]>();
  });

  test("ValidAnnotations<'write', [readOnly]> resolves the element to never", () => {
    type As = readonly [AnnotationValue<{ ttl: number }, 'read'>];
    type Gated = ValidAnnotations<'write', As>;
    expectTypeOf<Gated>().toEqualTypeOf<readonly [never]>();
  });

  test("ValidAnnotations<'read', [readOnly, both]> keeps both elements", () => {
    type As = readonly [
      AnnotationValue<{ ttl: number }, 'read'>,
      AnnotationValue<{ traceId: string }, 'read' | 'write'>,
    ];
    type Gated = ValidAnnotations<'read', As>;
    expectTypeOf<Gated>().toEqualTypeOf<
      readonly [
        AnnotationValue<{ ttl: number }, 'read'>,
        AnnotationValue<{ traceId: string }, 'read' | 'write'>,
      ]
    >();
  });

  test("ValidAnnotations<'write', [readOnly, writeOnly]> resolves the read-only element to never", () => {
    type As = readonly [
      AnnotationValue<{ ttl: number }, 'read'>,
      AnnotationValue<{ actor: string }, 'write'>,
    ];
    type Gated = ValidAnnotations<'write', As>;
    expectTypeOf<Gated>().toEqualTypeOf<
      readonly [never, AnnotationValue<{ actor: string }, 'write'>]
    >();
  });

  test('ValidAnnotations on the empty tuple is the empty tuple', () => {
    type Gated = ValidAnnotations<'read', readonly []>;
    expectTypeOf<Gated>().toEqualTypeOf<readonly []>();
  });

  test('an inapplicable element makes the gated tuple unassignable from a value containing it', () => {
    type As = readonly [
      AnnotationValue<{ ttl: number }, 'read'>,
      AnnotationValue<{ actor: string }, 'write'>,
    ];
    type Gated = ValidAnnotations<'read', As>;
    // The gated tuple's second element is `never`, so the original tuple
    // cannot be assigned to it.
    const original: As = [readOnly({ ttl: 60 }), writeOnly({ actor: 'system' })];
    // @ts-expect-error - second element resolves to never under 'read'
    const _gated: Gated = original;
    void _gated;
  });
});

describe('lane-terminal call-shape simulation', () => {
  /**
   * Mimics the shape lane terminals adopt: a variadic `...annotations`
   * parameter constrained by `ValidAnnotations<K, As>`. The `As` type
   * parameter is inferred from the call site's tuple of annotation values.
   *
   * Note: lane terminals must constrain the variadic argument as
   * `As & ValidAnnotations<K, As>`, not just `ValidAnnotations<K, As>`.
   * TypeScript's variadic-tuple inference is too forgiving when the
   * parameter type alone refers to `As`: it will pick an `As` that makes
   * the call valid even when the gated tuple contains `never`. The
   * intersection forces the argument to be assignable to BOTH the inferred
   * `As` AND the gated tuple, so a `never` element collapses to `never`
   * at the position where it lives and the call rejects the offending
   * argument.
   */
  function readTerminal<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'read', As>
  ): void {
    void annotations;
  }

  function writeTerminal<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'write', As>
  ): void {
    void annotations;
  }

  test('read terminal accepts read-only annotations', () => {
    readTerminal(readOnly({ ttl: 60 }));
  });

  test('read terminal accepts both-kind annotations', () => {
    readTerminal(both({ traceId: 't' }));
  });

  test('read terminal accepts a mix of read-only and both-kind annotations', () => {
    readTerminal(readOnly({ ttl: 60 }), both({ traceId: 't' }));
  });

  test('read terminal rejects write-only annotations (negative)', () => {
    // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
    readTerminal(writeOnly({ actor: 'system' }));
  });

  test('read terminal rejects a mix that includes a write-only annotation (negative)', () => {
    // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
    readTerminal(readOnly({ ttl: 60 }), writeOnly({ actor: 'system' }));
  });

  test('write terminal accepts write-only annotations', () => {
    writeTerminal(writeOnly({ actor: 'system' }));
  });

  test('write terminal accepts both-kind annotations', () => {
    writeTerminal(both({ traceId: 't' }));
  });

  test('write terminal rejects read-only annotations (negative)', () => {
    // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
    writeTerminal(readOnly({ ttl: 60 }));
  });

  test('terminals accept zero annotations (empty variadic)', () => {
    readTerminal();
    writeTerminal();
  });
});

describe('type narrowness preserved across the gate', () => {
  test('the read terminal preserves the typed payload of a both-kind annotation', () => {
    function inspect<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
      ...annotations: As & ValidAnnotations<'read', As>
    ): As {
      return annotations as unknown as As;
    }

    const out = inspect(both({ traceId: 't' }));
    // The handle's payload type survives the gate.
    assertType<{ traceId: string }>(out[0].value);
  });

  test('non-AnnotationValue elements in the tuple resolve to never (defensive)', () => {
    // Not part of the public API surface, but verifies the conditional's
    // fallback. If somebody constructs a tuple of arbitrary objects and runs
    // it through the gate, every element resolves to `never`.
    type As = readonly [{ not: 'an annotation' }];
    type Gated = ValidAnnotations<
      'read',
      As extends readonly AnnotationValue<unknown, OperationKind>[] ? As : never
    >;
    // The conditional's outer `As extends readonly AnnotationValue[...]`
    // branch makes the entire `As` resolve to `never`, which propagates
    // through ValidAnnotations.
    expectTypeOf<Gated>().toEqualTypeOf<never>();
  });
});
