import { createDataTypeLookup } from '@internal/framework-components/codec';
/**
 * The array lift's single-evaluation guarantee.
 *
 * This is the one guarantee with no visible output: a lift that evaluated its
 * source twice would produce byte-identical JSON in every conformance case, so
 * none of them can see it. The instrument is a volatile source — a `nextval`
 * whose sequence records how many times it ran — projected through the lift and
 * then read back. One advance means one evaluation.
 *
 * The lift is not modified here; `projectJson` is called directly with a
 * volatile expression, which the conformance harness cannot express because it
 * always projects a stored column.
 */

import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  CastExpr,
  FunctionCallExpr,
  JsonObjectExpr,
  LiteralExpr,
  NativeJsonValueProjection,
  ProjectionItem,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { createContract, createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresAdapterCapabilities } from '../src/core/capabilities';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

const contract: PostgresContract = {
  ...createContract<SqlStorage>({ target: 'postgres', targetFamily: 'sql' }),
  target: 'postgres',
};

const COUNTER = 'lift_evaluation_counter';

/** `string_to_array(nextval('…')::text, ',')` — a one-element text array that advances the counter once per evaluation. */
function volatileSource() {
  return FunctionCallExpr.of('string_to_array', [
    CastExpr.as(FunctionCallExpr.of('nextval', [LiteralExpr.of(COUNTER)]), 'text'),
    LiteralExpr.of(','),
  ]);
}

describe('array lift evaluates its source once', { concurrent: false }, () => {
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

  it('advances a volatile source exactly once per projected row', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const descriptor = postgresCodecDescriptorRegistry.descriptorFor('pg/text@1');
    const lifted = descriptor!.projectJson(volatileSource(), {
      codecId: 'pg/text@1',
      many: true,
    });
    const select = SelectAst.noFrom().withProjection([
      ProjectionItem.of(
        'doc',
        CastExpr.as(
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry('value', new NativeJsonValueProjection(lifted)),
          ]),
          'text',
        ),
      ),
    ]);
    const { sql } = renderLoweredSql(
      select,
      contract,
      postgresCodecDescriptorRegistry,
      postgresDataTypeLookup,
      postgresAdapterCapabilities,
    );

    await driver!.query(`DROP SEQUENCE IF EXISTS ${COUNTER}`);
    await driver!.query(`CREATE SEQUENCE ${COUNTER}`);

    const rows = (await driver!.query<{ doc: string }>(sql)).rows;
    const projected = JSON.parse(String(rows[0]?.doc)).value;

    const counter = (
      await driver!.query<{ last_value: string; is_called: boolean }>(
        `SELECT last_value, is_called FROM ${COUNTER}`,
      )
    ).rows;

    // `is_called` is what makes `last_value` mean anything: a sequence that was
    // never advanced also reads 1, so the two together are what pin the count at
    // exactly one. Two would mean the lift inlined the source into both the null
    // guard and the expansion instead of binding it in a derived table — and the
    // JSON would look identical either way, which is why this needs a counter.
    expect({ advanced: counter[0]?.is_called, value: String(counter[0]?.last_value) }).toEqual({
      advanced: true,
      value: '1',
    });
    // The projection still produced the value that single evaluation yielded.
    expect(projected).toEqual(['1']);
  });
});

/** The structural half of the same claim, which needs no database to make. */
describe('array lift binds its source once in the rendered SQL', () => {
  it('binds the source once in the rendered SQL', async () => {
    const descriptor = postgresCodecDescriptorRegistry.descriptorFor('pg/text@1');
    const lifted = descriptor!.projectJson(volatileSource(), {
      codecId: 'pg/text@1',
      many: true,
    });
    const select = SelectAst.noFrom().withProjection([
      ProjectionItem.of('doc', new NativeJsonValueProjection(lifted).value),
    ]);
    const { sql } = renderLoweredSql(
      select,
      contract,
      postgresCodecDescriptorRegistry,
      postgresDataTypeLookup,
      postgresAdapterCapabilities,
    );

    // The structural half of the same claim: the source text appears once, so a
    // reader of the SQL can see the binding rather than inferring it.
    expect(sql.split('nextval').length - 1).toBe(1);
  });
});
