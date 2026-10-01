import type { DataType } from '@internal/framework-components/codec';
import { SqlColumnDefaultIR, SqlColumnIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  pgDate,
  pgInterval,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
} from '../../src/core/data-types';
import {
  buildSetDefaultColumn,
  renderColumnDdl,
} from '../../src/core/migrations/column-ddl-rendering';

const noHooks = new Map();

function column(
  nativeType: string,
  codecId: string,
  dataType: DataType,
  value: string | readonly string[],
): SqlColumnIR {
  const many = Array.isArray(value);
  return new SqlColumnIR({
    name: 'v',
    nativeType,
    nullable: false,
    ...(many ? { many: true } : {}),
    authoredDefault: { kind: 'literal', value },
    resolvedDefault: { kind: 'literal', value },
    codecRef: { codecId, ...(many ? { many: true } : {}) },
    codecBaseNativeType: nativeType,
    dataType,
  });
}

function defaultNode(node: SqlColumnIR): SqlColumnDefaultIR {
  const [child] = node.children();
  if (child === undefined || !SqlColumnDefaultIR.is(child as SqlColumnDefaultIR)) {
    throw new Error('the column has no default node');
  }
  return child as SqlColumnDefaultIR;
}

describe('a date or time default written by the planner', () => {
  it.each([
    [
      'timestamptz',
      'pg/timestamptz-temporal@1',
      pgTimestamptz,
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
    ],
    [
      'timestamptz',
      'pg/timestamptz-temporal@1',
      pgTimestamptz,
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T00:00:00Z',
    ],
    [
      'timestamptz',
      'pg/timestamptz-string@1',
      pgTimestamptz,
      '2024-01-01 01:00:00+01',
      '2024-01-01T00:00:00Z',
    ],
    [
      'timestamptz',
      'pg/timestamptz-temporal@1',
      pgTimestamptz,
      '0044-03-15 00:00:00+00 BC',
      '-000043-03-15T00:00:00Z',
    ],
    [
      'timestamptz',
      'pg/timestamptz-temporal@1',
      pgTimestamptz,
      '0000-06-15T00:00:00Z',
      '0000-06-15T00:00:00Z',
    ],
    [
      'timestamptz',
      'pg/timestamptz-string@1',
      pgTimestamptz,
      '12026-01-02 03:04:05+00',
      '+012026-01-02T03:04:05Z',
    ],
    [
      'timestamp',
      'pg/timestamp-temporal@1',
      pgTimestamp,
      '2024-01-01 12:00:00',
      '2024-01-01T12:00:00',
    ],
    ['date', 'pg/date-temporal@1', pgDate, '0044-03-15 BC', '-000043-03-15'],
    ['time', 'pg/time-temporal@1', pgTime, '12:34:56.500', '12:34:56.5'],
    ['timetz', 'pg/timetz@1', pgTimetz, '12:34:56+02', '12:34:56+02:00'],
    ['interval', 'pg/interval@1', pgInterval, 'P13M', 'P1Y1M'],
  ])(
    'hands DDL a %s default through %s, given %s, as %s, in CREATE TABLE and SET DEFAULT alike',
    (nativeType, codecId, dataType, written, canonical) => {
      const node = column(nativeType, codecId, dataType, written);
      expect({
        createTable: renderColumnDdl('v', node, noHooks).default,
        setDefault: buildSetDefaultColumn('v', defaultNode(node), noHooks)?.default,
      }).toEqual({
        createTable: { kind: 'literal', value: canonical },
        setDefault: { kind: 'literal', value: canonical },
      });
    },
  );

  it('writes each element of a list default in canonical form', () => {
    const node = column('timestamptz', 'pg/timestamptz-temporal@1', pgTimestamptz, [
      '2024-01-01T00:00:00.000Z',
      '0044-03-15 00:00:00+00 BC',
    ]);
    const canonical = {
      kind: 'literal',
      value: ['2024-01-01T00:00:00Z', '-000043-03-15T00:00:00Z'],
    };
    expect({
      createTable: renderColumnDdl('v', node, noHooks).default,
      setDefault: buildSetDefaultColumn('v', defaultNode(node), noHooks),
    }).toEqual({
      createTable: canonical,
      setDefault: expect.objectContaining({ type: 'timestamptz[]', default: canonical }),
    });
  });

  it('refuses to write a contract default its data type does not hold, and says to re-emit', () => {
    const node = column(
      'timestamptz',
      'pg/timestamptz-temporal@1',
      pgTimestamptz,
      '2024-01-01 00:00:00',
    );
    const refusal = expect.objectContaining({
      code: 'CONTRACT.DEFAULT_INVALID',
      message:
        'Column "v": The contract holds this default in a form its data type does not store: pg/timestamptz needs a UTC offset, but "2024-01-01 00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z". Re-emit the contract, then try again.',
    });
    expect(() => renderColumnDdl('v', node, noHooks)).toThrow(refusal);
    expect(() => buildSetDefaultColumn('v', defaultNode(node), noHooks)).toThrow(refusal);
  });
});
