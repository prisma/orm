/**
 * The RLS authoring helpers are Postgres-only surface: they are exported from
 * `@internal/postgres/contract-builder` and reachable from no other
 * target's contract-builder. SQLite and Mongo authors never see them.
 */
import * as mongoContractBuilder from '@internal/mongo/contract-builder';
import * as postgresContractBuilder from '@internal/postgres/contract-builder';
import * as sqliteContractBuilder from '@internal/sqlite/contract-builder';
import { describe, expect, it } from 'vitest';

const RLS_HELPER_NAMES = [
  'policySelect',
  'policyInsert',
  'policyUpdate',
  'policyDelete',
  'policyAll',
  'rlsEnabled',
  'role',
] as const;

describe('RLS helper invisibility off Postgres', () => {
  it('the postgres contract-builder exports every RLS helper', () => {
    const exported: Record<string, unknown> = { ...postgresContractBuilder };
    for (const name of RLS_HELPER_NAMES) {
      expect(typeof exported[name], `postgres should export ${name}`).toBe('function');
    }
  });

  it('the sqlite contract-builder exports none of them', () => {
    const exported = Object.keys(sqliteContractBuilder);
    for (const name of RLS_HELPER_NAMES) {
      expect(exported, `sqlite must not export ${name}`).not.toContain(name);
    }
  });

  it('the mongo contract-builder exports none of them', () => {
    const exported = Object.keys(mongoContractBuilder);
    for (const name of RLS_HELPER_NAMES) {
      expect(exported, `mongo must not export ${name}`).not.toContain(name);
    }
  });

  it("an RLS handle in sqlite's defineContract fails the generic unclaimed-kind check", () => {
    const { field, model, policySelect, rlsEnabled, sql } = postgresContractBuilder;
    const intColumn = { codecId: 'sqlite/integer@1' } as const;
    const Profile = model('Profile', {
      fields: { id: field.column(intColumn).id() },
    }).sql({ table: 'profile' });

    expect(() =>
      sqliteContractBuilder.defineContract({
        models: { Profile },
        entities: [
          rlsEnabled(Profile),
          policySelect(Profile, { name: 'p_read', roles: [], using: sql`true` }),
        ],
      }),
    ).toThrow(/entityKind "rls", which no composed pack registers/);
  });
});
