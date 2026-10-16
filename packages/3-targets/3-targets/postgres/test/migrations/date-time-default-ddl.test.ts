import { SqlColumnDefaultIR, SqlColumnIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { pgTimestamptz } from '../../src/core/data-types';
import {
  buildSetDefaultColumn,
  renderColumnDdl,
} from '../../src/core/migrations/column-ddl-rendering';
import { postgresTypeLookups as types } from '../postgres-type-lookups';

function column(value: string | readonly (string | null)[] | null, many: boolean): SqlColumnIR {
  return new SqlColumnIR({
    name: 'v',
    nativeType: 'timestamptz',
    nullable: true,
    ...(many ? { many: true } : {}),
    authoredDefault: { kind: 'literal', value },
    resolvedDefault: { kind: 'literal', value },
    codecRef: { codecId: 'pg/timestamptz-temporal@1', ...(many ? { many: true } : {}) },
    codecBaseNativeType: 'timestamptz',
    dataType: pgTimestamptz,
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
    ['a value', '2024-01-01T00:00:00Z', false],
    ['a list with a null element', ['2024-01-01T00:00:00Z', null], true],
    ['a null list', null, true],
  ])(
    'hands DDL %s as the contract stores it, in CREATE TABLE and SET DEFAULT alike, for the adapter to write through the codec',
    (_name, value, many) => {
      const node = column(value, many);
      expect({
        createTable: renderColumnDdl('v', node, types).default,
        setDefault: buildSetDefaultColumn('v', defaultNode(node), types)?.default,
      }).toEqual({
        createTable: { kind: 'literal', value },
        setDefault: { kind: 'literal', value },
      });
    },
  );
});
