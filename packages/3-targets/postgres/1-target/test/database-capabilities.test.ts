import { describe, expect, expectTypeOf, it } from 'vitest';
import { databaseCapabilitiesOf, postgresDatabaseCapabilities } from '../src/core/server-version';
import postgresRuntimeTarget from '../src/exports/runtime';
import { postgresCapabilitiesByVersion } from '../src/exports/server-version';

describe("the database's capabilities", () => {
  it('are every flag any row of a table names, each as true, with its names known to the type', () => {
    const capabilities = databaseCapabilitiesOf({
      15: { sql: { returning: true, legacy: false } },
      17: { sql: { returning: true, mergeReturning: true }, postgres: { uuidv7: true } },
    });
    expect(capabilities).toEqual({
      sql: { returning: true, legacy: true, mergeReturning: true },
      postgres: { uuidv7: true },
    });
    expectTypeOf(capabilities).toEqualTypeOf<{
      readonly sql: {
        readonly returning: true;
        readonly legacy: true;
        readonly mergeReturning: true;
      };
      readonly postgres: { readonly uuidv7: true };
    }>();
  });

  it('are, for PostgreSQL, the flags of its table of versions', () => {
    expect(postgresDatabaseCapabilities).toEqual(postgresCapabilitiesByVersion[18]);
  });

  it('are declared by the runtime target, so a client does not ask its adapter or driver for them', () => {
    expect(postgresRuntimeTarget.databaseCapabilities).toBe(postgresDatabaseCapabilities);
  });
});
