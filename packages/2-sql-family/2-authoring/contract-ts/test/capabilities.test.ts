import { describe, expect, expectTypeOf, it } from 'vitest';
import { type CapabilitySet, resolveCapabilities } from '../src/capabilities';

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
    const wide: CapabilitySet = { sql: { batch: true } };
    const resolved = resolveCapabilities([row, wide]);

    expect(resolved).toEqual({ ...row, sql: { ...row.sql, batch: true } });
    expectTypeOf(resolved.sql).toEqualTypeOf<{
      readonly returning: true;
      readonly lateral: true;
    }>();
  });
});
