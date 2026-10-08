/**
 * The inherited array lift's guarantees, against a real database, now that the
 * element projections underneath it are real.
 *
 * `PostgresCodecDescriptor.jsonArrayProjection()` is not built or modified here.
 * It binds the source once in a derived table, guards the null array with a
 * `CASE`, expands with `unnest … WITH ORDINALITY`, guards each null element with
 * a `CASE`, and aggregates with `json_agg` ordered by ordinality and an
 * `emptyArray` empty case. Each of those is a separate claim below.
 *
 * The element codecs are chosen to span what the lift has to carry rather than
 * to be typical: `pg/numeric@1` is the canonical-text element whose entire point
 * is that it must not arrive as a JSON number, and `pg/jsonb@1` is a document
 * element, where a lift that stringified would be hardest to notice.
 */

import { ifDefined } from '@internal/utils/defined';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConformanceConnection, PostgresCodecConformanceCase } from '../src/index';
import { runPostgresCodecProjection } from '../src/index';
import { connectRuntimeDriver } from './runtime-connection';

function arrayCase(
  codecId: string,
  label: string,
  value: unknown,
  typeParams?: PostgresCodecConformanceCase['typeParams'],
): PostgresCodecConformanceCase {
  return {
    codecId,
    label,
    value,
    many: true,
    ...ifDefined('typeParams', typeParams),
  };
}

const cases: readonly PostgresCodecConformanceCase[] = [
  // --- the null array, the empty array, and null elements ---
  arrayCase('pg/int4@1', 'null array', null),
  arrayCase('pg/int4@1', 'empty array', []),
  arrayCase('pg/int4@1', 'null elements among values', [1, null, 3]),
  arrayCase('pg/int4@1', 'every element null', [null, null]),
  arrayCase('pg/text@1', 'null array', null),
  arrayCase('pg/text@1', 'empty array', []),
  arrayCase('pg/text@1', 'null elements among values', ['a', null, 'c']),

  // --- element order ---
  // Deliberately not sorted, and not the insertion-friendly order either: a lift
  // that dropped its ORDER BY would still pass on a sorted array.
  arrayCase('pg/int4@1', 'element order is preserved', [30, 10, 20, 1, 25]),
  arrayCase('pg/text@1', 'element order is preserved', ['delta', 'alpha', 'charlie', 'bravo']),

  // --- a canonical-text element ---
  // The whole point of pg/numeric@1 is that it must not reach JSON as a number.
  // Under the lift each element goes through the same projection, so a lift that
  // bypassed the element projection would show here and nowhere else.
  arrayCase('pg/numeric@1', 'canonical-text elements past double precision', [
    '9007199254740993',
    '1234567890.12345678901234567890',
    '1.5',
  ]),
  arrayCase('pg/numeric@1', 'canonical-text elements with nulls', ['9007199254740993', null]),

  // --- a document element ---
  arrayCase('pg/jsonb@1', 'document elements', [{ a: 1 }, { b: ['x', 'y'] }]),
  arrayCase('pg/jsonb@1', 'document elements with nulls', [{ a: 1 }, null]),
  arrayCase('pg/jsonb@1', 'string document elements', ['42', 'hello']),
  arrayCase('pg/jsonb@1', 'documents whose strings need escaping', [
    { 'k"y': 'v\\a"l' },
    { nested: ['x\ny'] },
  ]),

  // --- an element whose projection replaces the native conversion ---
  arrayCase('pg/bytea@1', 'base64 elements past the line-break width', [
    new Uint8Array([0, 1, 255]),
    Uint8Array.from({ length: 200 }, (_, index) => (index * 7) % 256),
  ]),
];

describe('PostgreSQL array lift conformance', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Awaited<ReturnType<typeof connectRuntimeDriver>> | undefined;
  let connection: ConformanceConnection | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    runtime = await connectRuntimeDriver(database.connectionString);
    connection = runtime.connection;
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await runtime?.close();
    runtime = undefined;
    connection = undefined;
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  for (const conformanceCase of cases) {
    it(`${conformanceCase.codecId} (${conformanceCase.label}) lifts to JSON and round-trips`, {
      timeout: timeouts.spinUpPpgDev,
    }, async () => {
      const outcome = await runPostgresCodecProjection(connection!, conformanceCase);
      expect(outcome.failure).toBeUndefined();
    });
  }
});
