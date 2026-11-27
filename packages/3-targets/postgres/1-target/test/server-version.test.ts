import { describe, expect, expectTypeOf, it } from 'vitest';
import { postgresCapabilitiesByVersion } from '../src/exports/server-version';
import {
  POSTGRES_MIN_SERVER_VERSION,
  POSTGRES_NEWEST_VERSION,
} from '../src/exports/server-version-range';

describe('the capabilities by PostgreSQL version', () => {
  it('lists versions 15 to 18', () => {
    expect(Object.keys(postgresCapabilitiesByVersion)).toEqual(['15', '16', '17', '18']);
  });

  it('names 18 as the newest version, typed as the literal', () => {
    expect(POSTGRES_NEWEST_VERSION).toBe(18);
    expectTypeOf(POSTGRES_NEWEST_VERSION).toEqualTypeOf<18>();
  });

  it('takes the minimum server version from its first row, typed as the literal', () => {
    expect(POSTGRES_MIN_SERVER_VERSION).toBe('15');
    expectTypeOf(POSTGRES_MIN_SERVER_VERSION).toEqualTypeOf<'15'>();
  });

  it('agrees with the table: the oldest and newest versions are its first and last rows', () => {
    const versions = Object.keys(postgresCapabilitiesByVersion);
    expect([versions[0], versions.at(-1)]).toEqual([
      POSTGRES_MIN_SERVER_VERSION,
      String(POSTGRES_NEWEST_VERSION),
    ]);
  });
});
