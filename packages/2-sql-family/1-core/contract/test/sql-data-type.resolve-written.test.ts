import { describe, expect, it } from 'vitest';
import { resolveWrittenSqlTypes as resolveWritten } from '../src/sql-data-type';
import { char, character, int4, numeric, timestamp, timestamptz } from './sql-data-type-fixtures';

/** resolveWrittenSqlTypes, with each resolved data type named by its id for the expectations. */
const resolveWrittenSqlTypes = (...args: Parameters<typeof resolveWritten>) =>
  resolveWritten(...args).map(({ dataType, typeParams }) => ({
    dataType: dataType.id,
    typeParams,
  }));

const types = [int4, numeric, char, timestamp];

describe('resolveWrittenSqlTypes', () => {
  it('reads a text a migration writes, as well as one the catalog prints', () => {
    expect([
      resolveWrittenSqlTypes('int4', types),
      resolveWrittenSqlTypes('integer', types),
      resolveWrittenSqlTypes('int', types),
    ]).toEqual([
      [{ dataType: 't/int4', typeParams: {} }],
      [{ dataType: 't/int4', typeParams: {} }],
      [{ dataType: 't/int4', typeParams: {} }],
    ]);
  });

  it('reads the parameters in normal form, ignoring letter case and spacing', () => {
    expect([
      resolveWrittenSqlTypes('NUMERIC( 10 )', types),
      resolveWrittenSqlTypes('character', types),
      resolveWrittenSqlTypes('timestamp(3)', types),
    ]).toEqual([
      [{ dataType: 't/numeric', typeParams: { precision: 10, scale: 0 } }],
      [{ dataType: 't/char', typeParams: { length: 1 } }],
      [{ dataType: 't/timestamp', typeParams: { precision: 3 } }],
    ]);
  });

  it('keeps the parameters as the text writes them beside their normal form', () => {
    expect(
      ['timestamptz', 'timestamptz(6)', 'numeric(10)'].map((text) =>
        resolveWritten(text, [timestamptz, numeric]).map(({ typeParams, writtenTypeParams }) => ({
          typeParams,
          writtenTypeParams,
        })),
      ),
    ).toEqual([
      [{ typeParams: { precision: 6 }, writtenTypeParams: {} }],
      [{ typeParams: { precision: 6 }, writtenTypeParams: { precision: 6 } }],
      [{ typeParams: { precision: 10, scale: 0 }, writtenTypeParams: { precision: 10 } }],
    ]);
  });

  it('lists every type that reads the text, and none for a text no type reads or parameters it refuses', () => {
    expect([
      resolveWrittenSqlTypes('character', [char, character]).map(({ dataType }) => dataType),
      resolveWrittenSqlTypes('int9', types),
      resolveWrittenSqlTypes('timestamp(9)', types),
    ]).toEqual([['t/char', 't/character'], [], []]);
  });
});
