/**
 * Negative type tests pinning that `schema` is REQUIRED on the Postgres
 * `Migration` methods.
 *
 * A Postgres migration must name its schema explicitly — there is no default
 * and no `search_path`-relative (unbound) option (see `postgres-migration.ts`
 * class JSDoc + design-notes "Migration schema-default convention"). These
 * `@ts-expect-error` assertions fail the compile if any method's `schema`
 * silently regresses to optional.
 *
 * The methods are `protected`, so the calls live inside a subclass body where
 * they are reachable.
 */

import { col, lit } from '@internal/sql-relational-core/contract-free';
import { test } from 'vitest';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';

class SchemaRequiredProbe extends PostgresMigration {
  override describe() {
    return { from: null, to: '0' };
  }

  override get operations() {
    return [
      this.createTable({ schema: 'public', table: 'user', columns: [col('id', 'text')] }),
      this.addColumn({ schema: 'public', table: 'user', column: col('email', 'text') }),
      this.dropTable({ schema: 'public', table: 'stale' }),
    ];
  }

  missingSchema() {
    return [
      // @ts-expect-error schema is required on Postgres Migration methods (no search_path-relative default)
      this.createTable({ table: 'user', columns: [col('id', 'text')] }),
      // @ts-expect-error schema is required on Postgres Migration methods (no search_path-relative default)
      this.addColumn({ table: 'user', column: col('email', 'text') }),
      // @ts-expect-error schema is required on Postgres Migration methods (no search_path-relative default)
      this.dropTable({ table: 'stale' }),
      // @ts-expect-error schema is required on Postgres Migration methods (no search_path-relative default)
      this.setDefault({ table: 'user', column: col('email', 'text', { default: lit('a') }) }),
    ];
  }
}

test('schema is required on Postgres Migration methods', () => {
  void SchemaRequiredProbe;
});
