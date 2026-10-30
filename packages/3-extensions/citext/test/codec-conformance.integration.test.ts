/**
 * Conformance for `pg/citext@1` against a real database. `CREATE EXTENSION` runs in each case's setup, so a dev database without citext fails here rather than downstream.
 */

import postgresRuntimeDriverDescriptor from '@internal/driver-postgres/runtime';
import type {
  ConformanceConnection,
  PostgresCodecConformanceCase,
} from '@internal/postgres-codec-testkit';
import { runPostgresCodecProjection } from '@internal/postgres-codec-testkit';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { citextDescriptor } from '../src/core/codecs';
import { citextCitext } from '../src/core/data-types';

const INSTALL_CITEXT = ['CREATE EXTENSION IF NOT EXISTS citext'] as const;

function citextCase(
  label: string,
  value: unknown,
  options: { readonly many?: true; readonly nullValue?: true } = {},
): PostgresCodecConformanceCase {
  return {
    codecId: 'pg/citext@1',
    descriptor: citextDescriptor,
    dataType: citextCitext,
    label,
    value,
    setupSql: INSTALL_CITEXT,
    ...options,
  };
}

const cases: readonly PostgresCodecConformanceCase[] = [
  citextCase('mixed case, kept as written', 'Ada@Example.COM'),
  citextCase('an empty string', ''),
  citextCase('quotes, a backslash and non-ASCII letters', 'Ünïcödé "quoted" \\ back'),
  citextCase('a null column', null, { nullValue: true }),
  citextCase('a column of several values', ['Alpha', 'beta', 'GAMMA'], { many: true }),
  citextCase('a column of values with a null element', ['Alpha', null], { many: true }),
];

describe('citext codec JSON-projection conformance', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  const driver = postgresRuntimeDriverDescriptor.create();
  let connection: ConformanceConnection | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    await driver.connect({ kind: 'url', url: database.connectionString });
    connection = {
      async query(sql, params) {
        const rows: Record<string, unknown>[] = [];
        for await (const row of driver.query<Record<string, unknown>>({
          sql,
          params: [...(params ?? [])],
        })) {
          rows.push(row);
        }
        return rows;
      },
    };
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver.close();
    connection = undefined;
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  for (const conformanceCase of cases) {
    it(`pg/citext@1 (${conformanceCase.label}) reads the same through its projection as through a row`, {
      timeout: timeouts.spinUpPpgDev,
    }, async () => {
      const outcome = await runPostgresCodecProjection(connection!, conformanceCase);
      expect(outcome.failure).toBeUndefined();
    });
  }

  it('compares without regard to case', { timeout: timeouts.spinUpPpgDev }, async () => {
    await connection!.query(INSTALL_CITEXT[0]);
    const rows = await connection!.query(
      "SELECT 'A@x.com'::citext = 'a@X.COM'::citext AS equal, 'B'::citext > 'a'::citext AS ordered, 'Hello'::citext LIKE 'hel%' AS matched",
    );
    expect(rows).toEqual([{ equal: 't', ordered: 't', matched: 't' }]);
  });
});
