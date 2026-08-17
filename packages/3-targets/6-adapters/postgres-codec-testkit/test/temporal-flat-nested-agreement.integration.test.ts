/**
 * Flat and nested reads of a temporal column must return the same text.
 *
 * A flat read transports the server's own rendering of the column. A nested read goes through the
 * descriptor's `jsonProjection` and lands inside a JSON document. Those were two different answers
 * until the projection started casting to `text`: `timestamptz` in particular went through a
 * UTC-pinned `to_char` whose format ended in `.MS`, so a nested read returned a different offset
 * *and* three fewer digits than a flat read of the same row.
 *
 * Every fixture below therefore carries a `.123456` microsecond component. That is the whole
 * discrimination: with the retired millisecond format still in place these assertions fail on the
 * truncated digits, whereas a whole-second fixture would pass either way and prove nothing.
 *
 * This measures the projection, not the codecs — both readings are taken as raw SQL text, so a case
 * cannot be rescued by a codec that happens to normalise the two spellings back together.
 */

import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProjectionSql, type PostgresCodecConformanceCase } from '../src/index';

const STORAGE_TABLE = 'codec_conformance';
const VALUE_COLUMN = 'value';
const DOCUMENT_ALIAS = 'document';

const PRECISION = { precision: 6 } as const;

interface AgreementCase {
  readonly codecId: string;
  readonly typeParams?: { readonly precision: number };
  /** A SQL literal, so the row is created without going near a codec. */
  readonly literal: string;
}

/**
 * Spellings taken from a live server rather than written from memory — the same matrix the Temporal
 * codecs were settled against.
 */
const AGREEMENT_CASES: readonly AgreementCase[] = [
  { codecId: 'pg/date-string@1', literal: "date '2026-01-02'" },
  { codecId: 'pg/date-temporal@1', literal: "date '2026-01-02'" },
  {
    codecId: 'pg/timestamp-string@1',
    typeParams: PRECISION,
    literal: "timestamp '2026-01-02 03:04:05.123456'",
  },
  {
    codecId: 'pg/timestamp-temporal@1',
    typeParams: PRECISION,
    literal: "timestamp '2026-01-02 03:04:05.123456'",
  },
  {
    codecId: 'pg/timestamptz-string@1',
    typeParams: PRECISION,
    literal: "timestamptz '2026-01-02 03:04:05.123456+00'",
  },
  {
    codecId: 'pg/timestamptz-temporal@1',
    typeParams: PRECISION,
    literal: "timestamptz '2026-01-02 03:04:05.123456+00'",
  },
  { codecId: 'pg/time-string@1', typeParams: PRECISION, literal: "time '03:04:05.123456'" },
  { codecId: 'pg/time-temporal@1', typeParams: PRECISION, literal: "time '03:04:05.123456'" },
];

function projectionCaseOf(entry: AgreementCase): PostgresCodecConformanceCase {
  return {
    codecId: entry.codecId,
    label: 'flat/nested agreement',
    value: undefined,
    ...(entry.typeParams ? { typeParams: entry.typeParams } : {}),
  };
}

describe.sequential('temporal flat and nested reads agree', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresControlDriverDescriptor.create(database.connectionString);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver?.close();
    driver = undefined;
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  async function readBothWays(
    entry: AgreementCase,
    session: readonly string[] = [],
  ): Promise<{ flat: string; nested: string }> {
    await driver!.query('RESET ALL');
    for (const statement of session) {
      await driver!.query(statement);
    }
    const ref = {
      codecId: entry.codecId,
      ...(entry.typeParams ? { typeParams: entry.typeParams } : {}),
    };
    const nativeType = postgresCodecDescriptorRegistry
      .descriptorFor(entry.codecId)!
      .nativeTypeFor(ref);
    await driver!.query(`DROP TABLE IF EXISTS "${STORAGE_TABLE}"`);
    await driver!.query(`CREATE TABLE "${STORAGE_TABLE}" ("${VALUE_COLUMN}" ${nativeType})`);
    await driver!.query(`INSERT INTO "${STORAGE_TABLE}" VALUES (${entry.literal})`);

    const flatRows = await driver!.query(
      `SELECT "${VALUE_COLUMN}"::text AS "${VALUE_COLUMN}" FROM "${STORAGE_TABLE}"`,
    );
    const nestedRows = await driver!.query(buildProjectionSql(projectionCaseOf(entry)));

    return {
      flat: String(flatRows.rows[0]?.[VALUE_COLUMN]),
      nested: String(
        (JSON.parse(String(nestedRows.rows[0]?.[DOCUMENT_ALIAS])) as Record<string, unknown>)[
          VALUE_COLUMN
        ],
      ),
    };
  }

  it.each(AGREEMENT_CASES.map((entry) => [entry.codecId, entry] as const))(
    '%s reads the same text flat and nested',
    async (_codecId, entry) => {
      const { flat, nested } = await readBothWays(entry);

      expect(nested).toBe(flat);
    },
    timeouts.spinUpPpgDev,
  );

  it('keeps the microseconds a millisecond format would have dropped', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const withSubsecond = AGREEMENT_CASES.filter((entry) => entry.typeParams !== undefined);
    const readings = [];
    for (const entry of withSubsecond) {
      readings.push(await readBothWays(entry));
    }

    expect(readings.map(({ nested }) => nested.includes('.123456'))).toEqual(
      withSubsecond.map(() => true),
    );
  });

  it('lets the session TimeZone reach a nested read, exactly as it reaches a flat one', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const tstz = AGREEMENT_CASES.find(
      (entry) => entry.codecId === 'pg/timestamptz-temporal@1',
    ) as AgreementCase;

    const utc = await readBothWays(tstz, ["SET TimeZone = 'UTC'"]);
    const tokyo = await readBothWays(tstz, ["SET TimeZone = 'Asia/Tokyo'"]);

    // The pinned projection this replaced would have produced the same UTC text under both.
    expect({ utc, tokyo }).toEqual({
      utc: {
        flat: '2026-01-02 03:04:05.123456+00',
        nested: '2026-01-02 03:04:05.123456+00',
      },
      tokyo: {
        flat: '2026-01-02 12:04:05.123456+09',
        nested: '2026-01-02 12:04:05.123456+09',
      },
    });
  });
});
