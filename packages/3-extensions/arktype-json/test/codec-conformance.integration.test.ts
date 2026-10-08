/**
 * Conformance for `arktype/json@1` against a real database.
 *
 * The codec is required-parameterized — a ref carries the arktype schema as
 * `{ expression, jsonIr }` — so each case builds its params from the same
 * `arktypeJsonColumn` helper an author would use. The schema governs validation
 * only: `toDataTypeValue` is a structural round-trip through `JSON.stringify`, so the
 * canonical form is the document itself and does not vary with the schema.
 *
 * The extension's descriptor is not in the target's built-in registry, so each
 * case carries it directly; everything else runs through the harness the
 * built-in codecs use.
 */

import type { JsonValue } from '@internal/contract/types';
import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import type {
  ConformanceConnection,
  PostgresCodecConformanceCase,
} from '@internal/postgres-codec-testkit';
import { runPostgresCodecProjection } from '@internal/postgres-codec-testkit';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { type } from 'arktype';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { arktypeJsonColumn, arktypeJsonDescriptor } from '../src/core/arktype-json-codec';

function schemaCase(
  label: string,
  schema: Parameters<typeof arktypeJsonColumn>[0],
  value: unknown,
): PostgresCodecConformanceCase {
  const column = arktypeJsonColumn(schema);
  return {
    codecId: arktypeJsonDescriptor.codecId,
    descriptor: arktypeJsonDescriptor,
    label,
    value,
    typeParams: {
      expression: column.typeParams.expression,
      jsonIr: column.typeParams.jsonIr as JsonValue,
    },
  };
}

const cases: readonly PostgresCodecConformanceCase[] = [
  schemaCase('document', type({ name: 'string', price: 'number' }), {
    name: 'Widget',
    price: 9.99,
  }),
  // The forms where "a document" and "a string containing a document" are
  // hardest to tell apart: at the top level there is no object to give it away.
  schemaCase('string at the top level', type('string'), 'plain'),
  schemaCase('number at the top level', type('number'), 42),
  schemaCase('null at the top level', type('null'), null),
  schemaCase('array at the top level', type('number[]'), [1, 2, 3]),
  // Escaping is where a text round-trip through the projection would show.
  schemaCase('strings needing JSON escaping', type({ 'k"y': 'string', nested: 'string[]' }), {
    'k"y': 'v\\a"l',
    nested: ['x\ny', 'tab\there'],
  }),
  schemaCase('string that is itself JSON text', type('string'), '{"not":"a document"}'),
];

describe('arktype-json codec JSON-projection conformance', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;
  let connection: ConformanceConnection | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresControlDriverDescriptor.create(database.connectionString);
    connection = { query: async (sql, params) => (await driver!.query(sql, params)).rows };
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver?.close();
    driver = undefined;
    connection = undefined;
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  for (const conformanceCase of cases) {
    it(`arktype/json@1 (${conformanceCase.label}) agrees with toDataTypeValue and round-trips through fromDataTypeValue`, {
      timeout: timeouts.spinUpPpgDev,
    }, async () => {
      const outcome = await runPostgresCodecProjection(connection!, conformanceCase);
      expect(outcome.failure).toBeUndefined();
    });
  }
});
