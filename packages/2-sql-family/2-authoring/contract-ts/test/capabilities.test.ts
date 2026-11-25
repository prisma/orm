import type { CapabilityMatrix } from '@internal/framework-components/components';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { resolveCapabilities } from '../src/capabilities';

const row = { sql: { returning: true, lateral: true }, postgres: { distinctOn: true } } as const;

describe('resolveCapabilities', () => {
  it('merges the sets in order, a later flag replacing an earlier one, and keeps the flags that are on', () => {
    const resolved = resolveCapabilities([
      row,
      { sql: { returning: false, pipelining: true } },
      { http: { batch: true }, sql: { pipelining: false } },
    ]);

    expect(resolved).toEqual({
      sql: { lateral: true },
      postgres: { distinctOn: true },
      http: { batch: true },
    });
    expectTypeOf(resolved).toEqualTypeOf<{
      readonly sql: { readonly lateral: true };
      readonly postgres: { readonly distinctOn: true };
      readonly http: { readonly batch: true };
    }>();
  });

  it('keeps the type of the earlier sets when a set has a wide type, which says nothing the type can merge', () => {
    const wide: CapabilityMatrix = { sql: { batch: true } };
    const resolved = resolveCapabilities([row, wide]);

    expect(resolved).toEqual({ ...row, sql: { ...row.sql, batch: true } });
    expectTypeOf(resolved.sql).toEqualTypeOf<{
      readonly returning: true;
      readonly lateral: true;
    }>();
  });
});

describe('resolveCapabilities with a list of unknown length', () => {
  it('keeps the type of the entries the type knows at the front', () => {
    const rest: CapabilityMatrix[] = [{ sql: { batch: true } }];
    const resolved = resolveCapabilities([row, ...rest]);

    expect(resolved.sql).toEqual({ ...row.sql, batch: true });
    expectTypeOf(resolved.sql).toEqualTypeOf<{
      readonly returning: true;
      readonly lateral: true;
    }>();
  });

  it('merges the literal sets after a spread of unknown length', () => {
    const shared: CapabilityMatrix[] = [];
    const off = resolveCapabilities([row, ...shared, { sql: { returning: false } }]);
    const on = resolveCapabilities([row, ...shared, { sql: { interactiveTransactions: true } }]);

    expect([off.sql, on.sql]).toEqual([
      { lateral: true },
      { returning: true, lateral: true, interactiveTransactions: true },
    ]);
    expectTypeOf(off.sql).toEqualTypeOf<{ readonly lateral: true }>();
    expectTypeOf(on.sql).toEqualTypeOf<{
      readonly returning: true;
      readonly lateral: true;
      readonly interactiveTransactions: true;
    }>();
  });

  it('keeps a flag in the type that a set with a wide type turns off at run time, a known limit', () => {
    const off: CapabilityMatrix = { sql: { returning: false } };
    const resolved = resolveCapabilities([row, off]);

    expect(resolved.sql).toEqual({ lateral: true });
    expectTypeOf(resolved.sql.returning).toEqualTypeOf<true>();
  });
});
