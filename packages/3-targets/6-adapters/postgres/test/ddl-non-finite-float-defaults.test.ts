import { col, lit } from '@internal/sql-relational-core/contract-free';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { PostgresCreateTable } from '@internal/target-postgres/ddl';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

const lookup = createPostgresBuiltinCodecLookup();
const adapter = new PostgresControlAdapter(lookup);

async function defaultClause(codecId: string, nativeType: string, value: number): Promise<string> {
  const stored = lookup.get(codecId)!.encodeJson(value);
  const table = new PostgresCreateTable({
    table: 't',
    columns: [col('c', nativeType, { default: lit(stored), codecRef: { codecId } })],
  });
  const lowered = await adapter.lowerToExecuteRequest(table, { contract: {} as PostgresContract });
  return lowered.sql;
}

describe('a NaN or infinite float default in PostgreSQL DDL', () => {
  it.each([
    ['sql/float@1', 'float8'],
    ['pg/float@1', 'float8'],
    ['pg/float8@1', 'float8'],
    ['pg/float4@1', 'float4'],
  ])(
    '%s renders as the text PostgreSQL reads for the value, cast to %s',
    async (codecId, nativeType) => {
      const values = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN];
      const clauses = await Promise.all(
        values.map((value) => defaultClause(codecId, nativeType, value)),
      );
      expect(clauses).toEqual(
        ['Infinity', '-Infinity', 'NaN'].map(
          (text) => `CREATE TABLE "t" (\n  "c" ${nativeType} DEFAULT '${text}'::${nativeType}\n)`,
        ),
      );
    },
  );
});
