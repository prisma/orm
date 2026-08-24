/**
 * Importing this driver must not read `pg.types`.
 *
 * Four suites in other packages — three in `@internal/postgres`, one in `@internal/extension-supabase`
 * — mock `pg` with a minimal double that has no `types` export. A module-scope read of
 * `pg.types.<anything>` therefore makes *importing* the driver throw in all four, with a stack that
 * points at this package rather than at whatever the test was doing.
 *
 * That has now happened twice: once when the temporal parsers first read `pg.types.builtins` at
 * module scope, and again when a corrected type for `getTypeParser` was hoisted into a
 * module-scope `const`. Both times the owning package's own suite stayed green and four unrelated
 * suites went red. This test puts the tripwire where the mistake gets made.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The double that the consuming suites use: `pg` with no `types` export at all.
vi.mock('pg', () => ({ default: {}, Client: class {}, Pool: class {} }));

describe('importing the temporal text parsers under a types-less pg mock', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not touch pg.types at import time', async () => {
    const module = await import('../src/temporal-text-parsers');

    expect(module.temporalTextTypes).toBeDefined();
  });

  it('defers the failure to the first parser lookup, where a real pg would be present', async () => {
    const { temporalTextTypes } = await import('../src/temporal-text-parsers');

    // A temporal scalar OID is answered from this module and needs nothing from `pg`.
    expect(temporalTextTypes.getTypeParser(1114, 'text')('2026-01-02 03:04:05')).toBe(
      '2026-01-02 03:04:05',
    );
    // Anything else forwards to `pg`, which the mock has gutted — so it throws here, at the call,
    // rather than at import.
    expect(() => temporalTextTypes.getTypeParser(25, 'text')).toThrow();
  });
});
