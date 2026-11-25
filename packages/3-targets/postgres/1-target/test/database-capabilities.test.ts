import { describe, expect, it } from 'vitest';
import postgresRuntimeTarget from '../src/exports/runtime';
import {
  databaseCapabilitiesOf,
  postgresCapabilitiesByVersion,
  postgresDatabaseCapabilities,
} from '../src/exports/server-version';

describe("the database's capabilities", () => {
  it('are every flag any row of a table provides', () => {
    expect(
      databaseCapabilitiesOf({
        15: { sql: { returning: true } },
        17: { sql: { returning: true, mergeReturning: true }, postgres: { uuidv7: true } },
      }),
    ).toEqual({ sql: { returning: true, mergeReturning: true }, postgres: { uuidv7: true } });
  });

  it('are, for PostgreSQL, the flags of its table of versions', () => {
    expect(postgresDatabaseCapabilities).toEqual(postgresCapabilitiesByVersion[18]);
  });

  it('are declared by the runtime target, so a client does not ask its adapter or driver for them', () => {
    expect(postgresRuntimeTarget.databaseCapabilities).toBe(postgresDatabaseCapabilities);
  });
});
