import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AggregateExpr,
  CastExpr,
  JsonObjectExpr,
  LiteralExpr,
  NativeJsonValueProjection,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { createContract, litParams } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { postgresAdapterCapabilities } from '../src/core/capabilities';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const contract: PostgresContract = {
  ...createContract<SqlStorage>({ target: 'postgres', targetFamily: 'sql' }),
  target: 'postgres',
};
const dataTypeLookup = createDataTypeLookup(postgresDataTypes);
const lower = (ast: SelectAst) =>
  renderLoweredSql(
    ast,
    contract,
    postgresCodecDescriptorRegistry,
    dataTypeLookup,
    postgresAdapterCapabilities,
  );

describe('Postgres JSON object argument limits', () => {
  it.each([0, 1, 50, 51, 55, 101])(
    'lowers all %i entries within the function argument limit',
    (count) => {
      const entries = Array.from({ length: count }, (_, i) =>
        JsonObjectExpr.entry(`field_${i}`, new NativeJsonValueProjection(LiteralExpr.of(i))),
      );
      const { sql, params } = lower(
        SelectAst.noFrom().withProjection([
          ProjectionItem.of('doc', JsonObjectExpr.fromEntries(entries)),
        ]),
      );

      const calls = [...sql.matchAll(/json_build_object\(([^()]*)\)/g)];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call[1] === '' ? 0 : call[1]?.split(', ').length).toBeLessThanOrEqual(100);
      }
      expect([...sql.matchAll(/'field_(\d+)'/g)].map((match) => Number(match[1]))).toEqual(
        Array.from({ length: count }, (_, i) => i),
      );
      expect(params).toEqual([]);
      if (count <= 50) {
        expect(sql).toBe(
          `SELECT json_build_object(${Array.from({ length: count }, (_, i) => `'field_${i}', ${i}`).join(', ')}) AS "doc"`,
        );
      }
    },
  );

  it('retains parameter order and shared parameter identity across chunks', () => {
    const values = Array.from({ length: 55 }, (_, i) => i + 1);
    const parameters = values.map((value) =>
      ParamRef.of(value, { codec: { codecId: 'pg/int4@1' } }),
    );
    const entries = parameters.map((parameter, i) =>
      JsonObjectExpr.entry(
        `field_${i}`,
        new NativeJsonValueProjection(CastExpr.as(parameter, 'int4')),
      ),
    );
    const first = parameters[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error('Missing parameter fixture');
    entries.push(
      JsonObjectExpr.entry(
        'first_again',
        new NativeJsonValueProjection(CastExpr.as(first, 'int4')),
      ),
    );
    const { sql, params } = lower(
      SelectAst.noFrom().withProjection([
        ProjectionItem.of('doc', JsonObjectExpr.fromEntries(entries)),
      ]),
    );

    expect(params).toEqual(litParams(...values));
    expect([...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]))).toEqual([...values, 1]);
  });

  it('keeps aggregate expressions in the original SELECT scope', () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      JsonObjectExpr.entry(`field_${i}`, new NativeJsonValueProjection(LiteralExpr.of(i))),
    );
    entries.push(
      JsonObjectExpr.entry('count', new NativeJsonValueProjection(AggregateExpr.count())),
    );
    const { sql } = lower(
      SelectAst.from(TableSource.named('rows')).withProjection([
        ProjectionItem.of('doc', JsonObjectExpr.fromEntries(entries)),
      ]),
    );

    expect(sql.match(/\bSELECT\b/g)).toHaveLength(1);
    expect(sql.match(/COUNT\(\*\)/g)).toHaveLength(1);
    expect(sql).not.toContain('jsonb');
  });
});
