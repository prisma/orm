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
  renderColumnDdl,
  renderColumnDefaultSql,
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
      "'2024-01-01T00:00:00Z'",
    ],
    [
      'timestamptz',
      'pg/timestamptz-temporal@1',
      pgTimestamptz,
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T00:00:00Z',
      "'2024-01-01T00:00:00Z'",
    ],
    [
      'timestamptz',
      'pg/timestamptz-string@1',
      pgTimestamptz,
      '2024-01-01 01:00:00+01',
      '2024-01-01T00:00:00Z',
      "'2024-01-01T00:00:00Z'",
    ],
    [
      'timestamptz',
      'pg/timestamptz-temporal@1',
      pgTimestamptz,
      '0044-03-15 00:00:00+00 BC',
      '-000043-03-15T00:00:00Z',
      "'0044-03-15T00:00:00Z BC'",
    ],
    [
      'timestamptz',
      'pg/timestamptz-temporal@1',
      pgTimestamptz,
      '0000-06-15T00:00:00Z',
      '0000-06-15T00:00:00Z',
      "'0001-06-15T00:00:00Z BC'",
    ],
    [
      'timestamptz',
      'pg/timestamptz-string@1',
      pgTimestamptz,
      '12026-01-02 03:04:05+00',
      '+012026-01-02T03:04:05Z',
      "'12026-01-02T03:04:05Z'",
    ],
    [
      'timestamp',
      'pg/timestamp-temporal@1',
      pgTimestamp,
      '2024-01-01 12:00:00',
      '2024-01-01T12:00:00',
      "'2024-01-01T12:00:00'",
    ],
    ['date', 'pg/date-temporal@1', pgDate, '0044-03-15 BC', '-000043-03-15', "'0044-03-15 BC'"],
    ['time', 'pg/time-temporal@1', pgTime, '12:34:56.500', '12:34:56.5', "'12:34:56.5'"],
    ['timetz', 'pg/timetz@1', pgTimetz, '12:34:56+02', '12:34:56+02:00', "'12:34:56+02:00'"],
    ['interval', 'pg/interval@1', pgInterval, 'P13M', 'P1Y1M', "'P1Y1M'"],
  ])(
    'writes a %s default through %s, given %s, as %s, with the SQL literal %s',
    (nativeType, codecId, dataType, written, canonical, literal) => {
      const node = column(nativeType, codecId, dataType, written);
      expect({
        createTable: renderColumnDdl('v', node, noHooks).default,
        setDefault: renderColumnDefaultSql('v', defaultNode(node), noHooks),
      }).toEqual({
        createTable: { kind: 'literal', value: canonical },
        setDefault: `DEFAULT ${literal}`,
      });
    },
  );

  it('writes each element of a list default in canonical form', () => {
    const node = column('timestamptz', 'pg/timestamptz-temporal@1', pgTimestamptz, [
      '2024-01-01T00:00:00.000Z',
      '0044-03-15 00:00:00+00 BC',
    ]);
    expect({
      createTable: renderColumnDdl('v', node, noHooks).default,
      setDefault: renderColumnDefaultSql('v', defaultNode(node), noHooks),
    }).toEqual({
      createTable: {
        kind: 'literal',
        value: ['2024-01-01T00:00:00Z', '-000043-03-15T00:00:00Z'],
      },
      setDefault: "DEFAULT ARRAY['2024-01-01T00:00:00Z', '0044-03-15T00:00:00Z BC']::timestamptz[]",
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
    expect(() => renderColumnDefaultSql('v', defaultNode(node), noHooks)).toThrow(refusal);
  });
});
