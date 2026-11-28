import { describe, expect, it } from 'vitest';
import { targetSupportFor } from '../../src/target-support';
import { postgresSupport } from '../../src/targets/postgres';
import { sqliteSupport } from '../../src/targets/sqlite';

const supports = [postgresSupport, sqliteSupport];

describe('targetSupportFor', () => {
  it("finds the support for the contract's target", () => {
    expect(targetSupportFor({ targetFamily: 'sql', target: 'sqlite' }, supports)).toBe(
      sqliteSupport,
    );
    expect(targetSupportFor({ targetFamily: 'sql', target: 'postgres' }, supports)).toBe(
      postgresSupport,
    );
  });

  it('refuses a client that is not for a SQL database, before it looks for a support', () => {
    expect(() => targetSupportFor({ targetFamily: 'mongo', target: 'postgres' }, supports)).toThrow(
      expect.objectContaining({
        name: 'BetterAuthError',
        message:
          '@prisma/orm-better-auth supports only SQL databases, and this Prisma client is for a "mongo" database. Pass the client of a SQL database.',
      }),
    );
  });

  it('refuses a SQL target that no support is for, and names the targets it supports', () => {
    expect(() => targetSupportFor({ targetFamily: 'sql', target: 'mysql' }, supports)).toThrow(
      expect.objectContaining({
        name: 'BetterAuthError',
        message:
          '@prisma/orm-better-auth does not support this Prisma client\'s database, "mysql". It supports "postgres" and "sqlite".',
      }),
    );
  });
});
