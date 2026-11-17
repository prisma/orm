import { expectTypeOf, test } from 'vitest';
import { type BfsStep, bfs } from '../src/graph-ops';

interface TestEdge {
  readonly from: string;
  readonly to: string;
}

// ---------------------------------------------------------------------------
// String overload — `key` is omittable, S is bound to `string`.
// ---------------------------------------------------------------------------

test('string overload omits `key` and binds S to string', () => {
  const gen = bfs(['A'], (n) => {
    expectTypeOf(n).toEqualTypeOf<string>();
    return [] as { next: string; edge: TestEdge }[];
  });
  expectTypeOf(gen).toEqualTypeOf<Generator<BfsStep<string, TestEdge>>>();
});

test('string overload yields BfsStep<string, E>', () => {
  for (const step of bfs(['A'], (_n) => [] as { next: string; edge: TestEdge }[])) {
    expectTypeOf(step.state).toEqualTypeOf<string>();
    expectTypeOf(step.parent).toEqualTypeOf<string | null>();
    expectTypeOf(step.incomingEdge).toEqualTypeOf<TestEdge | null>();
  }
});

// ---------------------------------------------------------------------------
// Composite overload — `key` is required when S isn't `string`.
// ---------------------------------------------------------------------------

interface Composite {
  readonly node: string;
  readonly mask: number;
}

test('composite overload accepts a typed `key` and binds S to the composite', () => {
  const gen = bfs<Composite, TestEdge>(
    [{ node: 'A', mask: 0 }],
    (s) => {
      expectTypeOf(s).toEqualTypeOf<Composite>();
      return [] as { next: Composite; edge: TestEdge }[];
    },
    (s) => {
      expectTypeOf(s).toEqualTypeOf<Composite>();
      return JSON.stringify([s.node, s.mask]);
    },
  );
  expectTypeOf(gen).toEqualTypeOf<Generator<BfsStep<Composite, TestEdge>>>();
});

test('composite overload rejects calls that omit `key`', () => {
  // @ts-expect-error — `key` is required when S is non-string. Without an
  // explicit key the call cannot bind to the string overload (starts is
  // Composite, not string), and the composite overload requires `key`.
  bfs<Composite, TestEdge>([{ node: 'A', mask: 0 }], (_s) => []);
});

test('composite overload rejects a `key` whose return type is not string', () => {
  bfs<Composite, TestEdge>(
    [{ node: 'A', mask: 0 }],
    (_s) => [],
    // @ts-expect-error — key must return string, not number
    (s) => s.mask,
  );
});

test('composite overload rejects neighbours that yield mismatched state shape', () => {
  bfs<Composite, TestEdge>(
    [{ node: 'A', mask: 0 }],
    // @ts-expect-error — `next` must be Composite, not string
    (_s) => [{ next: 'B', edge: { from: 'A', to: 'B' } }],
    (s) => JSON.stringify([s.node, s.mask]),
  );
});
