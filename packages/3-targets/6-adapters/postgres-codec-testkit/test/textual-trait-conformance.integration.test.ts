/**
 * A codec that declares the `textual` trait gets `like`, `ilike`, the full-text operations, the tsquery parsers' text argument, and `@@fullTextIndex`. Each of them hands the column to PostgreSQL where it expects `text`. This suite checks, against a live PostgreSQL, that it accepts the column of every built-in `textual` codec in those places.
 *
 * The codecs under test are read off the descriptors, so a codec that declares `textual` is checked the moment it declares it. A native enum is the case this caught: PostgreSQL has no `ILIKE` and no `to_tsvector` for an enum type, so every one of those operations typechecked on an enum column and failed at runtime.
 */

import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import { SqlQueryError } from '@internal/sql-errors';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import {
  DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
  renderFullTextIndexExpression,
} from '@internal/target-postgres/sql-utils';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AggregateFixture, FIXTURES, nativeTypeOf, refOf } from './aggregate-matrix';

type Query = (sql: string) => Promise<ReadonlyArray<Record<string, unknown>>>;

const TABLE = 'textual_conformance';
const COLUMN = 'value';
const TO_TSVECTOR = renderFullTextIndexExpression(DEFAULT_FULL_TEXT_SEARCH_LANGUAGE, COLUMN);

const TEXT_POSITIONS = [
  { position: 'ilike', sql: `SELECT "${COLUMN}" ILIKE '%a%' FROM "${TABLE}"` },
  { position: 'toTsvector', sql: `SELECT ${TO_TSVECTOR} FROM "${TABLE}"` },
  {
    position: 'parser',
    sql: `SELECT websearch_to_tsquery('${DEFAULT_FULL_TEXT_SEARCH_LANGUAGE}', "${COLUMN}") FROM "${TABLE}"`,
  },
  {
    position: 'fullTextIndex',
    sql: `CREATE INDEX "${TABLE}_search" ON "${TABLE}" USING gin (${TO_TSVECTOR})`,
  },
] as const;

interface Refusal {
  readonly position: (typeof TEXT_POSITIONS)[number]['position'];
  readonly sqlState: string | undefined;
}

function traitsOf(descriptor: { readonly traits: readonly string[] }): readonly string[] {
  return descriptor.traits;
}

const TEXTUAL_CODEC_IDS = [...postgresCodecDescriptorRegistry.values()]
  .filter((descriptor) => traitsOf(descriptor).includes('textual'))
  .map((descriptor) => descriptor.codecId);

function fixtureFor(codecId: string): AggregateFixture {
  const fixture = FIXTURES.find((candidate) => candidate.codecId === codecId);
  if (fixture === undefined) throw new Error(`No fixture for '${codecId}'.`);
  return fixture;
}

describe('PostgreSQL textual trait conformance', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;
  let query: Query;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresControlDriverDescriptor.create(database.connectionString);
    query = async (sql) => (await driver!.query(sql, [])).rows;
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver?.close();
    driver = undefined;
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  /** The places PostgreSQL refuses a column of this fixture's type where it expects `text`. */
  async function refusedTextPositions(fixture: AggregateFixture): Promise<readonly Refusal[]> {
    await query(`DROP TABLE IF EXISTS "${TABLE}"`);
    for (const statement of fixture.setupSql ?? []) {
      await query(statement);
    }
    const nativeType = nativeTypeOf(refOf(fixture));
    await query(`CREATE TABLE "${TABLE}" ("${COLUMN}" ${nativeType})`);
    await query(
      `INSERT INTO "${TABLE}" ("${COLUMN}") VALUES ((${fixture.samples[0]})::${nativeType})`,
    );

    const refusals: Refusal[] = [];
    for (const { position, sql } of TEXT_POSITIONS) {
      try {
        await query(sql);
      } catch (error) {
        if (!SqlQueryError.is(error)) throw error;
        refusals.push({ position, sqlState: error.sqlState });
      }
    }
    return refusals;
  }

  it('finds the textual codecs on the descriptors', () => {
    expect(TEXTUAL_CODEC_IDS).toEqual(expect.arrayContaining(['pg/text@1', 'pg/varchar@1']));
  });

  for (const codecId of TEXTUAL_CODEC_IDS) {
    it(`${codecId} is accepted wherever PostgreSQL expects text`, {
      timeout: timeouts.spinUpPpgDev,
    }, async () => {
      expect(await refusedTextPositions(fixtureFor(codecId))).toEqual([]);
    });
  }

  it('refuses a native enum column in every one of those places, so the checks can fail', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const undefinedFunction = '42883';

    expect(await refusedTextPositions(fixtureFor('pg/enum@1'))).toEqual([
      { position: 'ilike', sqlState: undefinedFunction },
      { position: 'toTsvector', sqlState: undefinedFunction },
      { position: 'parser', sqlState: undefinedFunction },
      { position: 'fullTextIndex', sqlState: undefinedFunction },
    ]);
  });
});
