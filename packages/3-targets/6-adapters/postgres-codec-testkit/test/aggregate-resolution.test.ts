/**
 * What the PostgreSQL target's aggregate registry answers, asked without a
 * database.
 *
 * These are the statements a probe cannot settle: which inputs a lossless
 * variant is *offered* over is policy, not a fact PostgreSQL holds — it computes
 * `sum` over every integer whether or not the target names a `sumBigInt` for it.
 * The same goes for which overload wins where two could match, and for the
 * empty-set answer each row declares. The sibling
 * `aggregate-conformance.integration.test.ts` measures the rest against a live
 * server.
 */

import { postgresCodecRegistry } from '@internal/target-postgres/codecs';
import { describe, expect, it } from 'vitest';
import {
  COLUMN,
  FIXTURES,
  integerInputs,
  LOSSLESS_VARIANT_INPUTS,
  nativeTypeOf,
  READS_A_COMPUTED_TYPE,
  registry,
  TABLE,
} from './aggregate-matrix';
import { aggregateSql } from './aggregate-sql';

describe('PostgreSQL aggregate resolution', () => {
  it('covers every built-in codec', () => {
    const fixtured = new Set(FIXTURES.map((fixture) => fixture.codecId));
    const uncovered = [...postgresCodecRegistry.values()]
      .map((descriptor) => descriptor.codecId)
      .filter((codecId) => !fixtured.has(codecId));

    expect(uncovered).toEqual([]);
  });

  it('names a computed type only where the declared codec reads one it does not store', () => {
    const redundant = READS_A_COMPUTED_TYPE.filter(({ operation, codecId, computed }) => {
      const resolved = registry.resolve(operation, { codecId });
      return resolved !== undefined && nativeTypeOf(resolved.output) === computed;
    });

    expect(redundant).toEqual([]);
  });

  it('offers each lossless variant over exactly the inputs the policy gives it', () => {
    const claimed = Object.fromEntries(
      Object.keys(LOSSLESS_VARIANT_INPUTS).map((operation) => [
        operation,
        FIXTURES.map((fixture) => fixture.codecId)
          .filter((codecId) => registry.resolve(operation, { codecId }) !== undefined)
          .sort(),
      ]),
    );

    expect(claimed).toEqual(LOSSLESS_VARIANT_INPUTS);
  });

  it('offers the lossless sum over every integer input the bare sum accepts, and over no other', () => {
    const integers = [...integerInputs()].sort();
    const claimed = FIXTURES.map((fixture) => fixture.codecId)
      .filter((codecId) => registry.resolve('sumBigInt', { codecId }) !== undefined)
      .sort();

    expect(integers.length).toBeGreaterThan(0);
    expect(claimed).toEqual(integers);
  });

  it('resolves count and countBigInt with and without an input', () => {
    expect(registry.resolve('count')).toEqual({
      operation: 'count',
      output: { codecId: 'pg/int8number@1' },
      nullable: false,
      emptyResultJson: 0,
      lower: undefined,
    });
    expect(registry.resolve('count', { codecId: 'pg/text@1' })?.output).toEqual({
      codecId: 'pg/int8number@1',
    });

    expect(registry.resolve('countBigInt')).toMatchObject({
      operation: 'countBigInt',
      output: { codecId: 'pg/int8@1' },
      nullable: false,
    });
    expect(registry.resolve('countBigInt', { codecId: 'pg/text@1' })?.output).toEqual({
      codecId: 'pg/int8@1',
    });

    // `countBigInt` computes with `count`, over rows and over values alike.
    expect({
      overRows: aggregateSql({
        operation: 'countBigInt',
        lower: registry.resolve('countBigInt')?.lower,
        inputCodec: undefined,
        table: TABLE,
        column: undefined,
      }),
      overValues: aggregateSql({
        operation: 'countBigInt',
        lower: registry.resolve('countBigInt', { codecId: 'pg/text@1' })?.lower,
        inputCodec: { codecId: 'pg/text@1' },
        table: TABLE,
        column: COLUMN,
      }),
    }).toEqual({
      overRows: 'count(*)',
      overValues: `count("${TABLE}"."${COLUMN}")`,
    });
  });

  it.each(['min', 'max'])('preserves Date codec identity and precision for %s', (operation) => {
    expect(
      registry.resolve(operation, {
        codecId: 'pg/timestamptz-date@1',
        typeParams: { precision: 3 },
      })?.output,
    ).toEqual({ codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } });
  });

  it('prefers the exact varchar overload over the textual fallback', () => {
    expect(
      registry.resolve('min', { codecId: 'pg/varchar@1', typeParams: { length: 10 } })?.output,
    ).toEqual({ codecId: 'pg/text@1' });
    expect(registry.resolve('min', { codecId: 'pg/text@1' })?.output).toEqual({
      codecId: 'pg/text@1',
    });
    expect(
      registry.resolve('max', { codecId: 'pg/char@1', typeParams: { length: 3 } })?.output,
    ).toEqual({
      codecId: 'pg/char@1',
      typeParams: { length: 3 },
    });
  });

  it('resolves min/max over the representation codecs through the numeric-trait fallback', () => {
    expect(registry.resolve('min', { codecId: 'pg/int8number@1' })?.output).toEqual({
      codecId: 'pg/int8number@1',
    });
    expect(registry.resolve('max', { codecId: 'pg/int8number@1' })?.output).toEqual({
      codecId: 'pg/int8number@1',
    });
    expect(registry.resolve('min', { codecId: 'pg/unboundedint@1' })?.output).toEqual({
      codecId: 'pg/unboundedint@1',
    });
    expect(registry.resolve('max', { codecId: 'pg/unboundedint@1' })?.output).toEqual({
      codecId: 'pg/unboundedint@1',
    });
  });

  // A lossless variant reads the same empty-set answer its bare namesake does,
  // so it declares the same nullability. What PostgreSQL actually returns over
  // an empty set is measured in the conformance suite.
  it('declares one nullability per operation, bare and lossless alike', () => {
    expect({
      count: registry.resolve('count')?.nullable,
      countBigInt: registry.resolve('countBigInt')?.nullable,
      sum: registry.resolve('sum', { codecId: 'pg/int4@1' })?.nullable,
      sumBigInt: registry.resolve('sumBigInt', { codecId: 'pg/int4@1' })?.nullable,
      avg: registry.resolve('avg', { codecId: 'pg/int4@1' })?.nullable,
      avgDecimal: registry.resolve('avgDecimal', { codecId: 'pg/int4@1' })?.nullable,
      min: registry.resolve('min', { codecId: 'pg/int4@1' })?.nullable,
    }).toEqual({
      count: false,
      countBigInt: false,
      sum: true,
      sumBigInt: true,
      avg: true,
      avgDecimal: true,
      min: true,
    });
  });
});
