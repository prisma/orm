import { describe, expect, it } from 'vitest';
import * as contractFree from '../../src/exports/contract-free';
import {
  int4,
  jsonb,
  PostgresTableSource,
  pgTable,
  text,
  textArray,
  timestamptz,
  timestamptzJsDate,
} from '../../src/exports/contract-free';

describe('postgres column type helpers', () => {
  it('does not export the retired Date preset name', () => {
    expect(contractFree).not.toHaveProperty('timestamptzDate');
  });

  it('column helpers return expected codec descriptors', () => {
    expect({
      text: text(),
      int4: int4(),
      jsonb: jsonb(),
      textArray: textArray(),
      timestamptz: timestamptz(),
      timestamptzJsDate: timestamptzJsDate(),
      nullableDate: timestamptzJsDate({ nullable: true }),
    }).toEqual({
      text: { codecId: 'pg/text@1', nullable: false },
      int4: { codecId: 'pg/int4@1', nullable: false },
      jsonb: { codecId: 'pg/jsonb@1', nullable: false },
      textArray: { codecId: 'pg/text@1', nullable: false, many: true },
      timestamptz: { codecId: 'pg/timestamptz-string@1', nullable: false },
      timestamptzJsDate: { codecId: 'pg/timestamptz-date@1', nullable: false },
      nullableDate: { codecId: 'pg/timestamptz-date@1', nullable: true },
    });
  });

  it('text({ nullable: true }) returns a nullable descriptor', () => {
    expect(text({ nullable: true }).nullable).toBe(true);
  });
});

describe('pgTable()', () => {
  const marker = pgTable(
    { name: 'marker', schema: 'prisma_contract' },
    {
      space: text(),
      core_hash: text(),
      contract_json: jsonb({ nullable: true }),
      canonical_version: int4({ nullable: true }),
      updated_at: timestamptz(),
      invariants: textArray(),
    },
  );

  it('creates a PostgresTableSource', () => {
    expect(marker.source).toBeInstanceOf(PostgresTableSource);
    expect(marker.source.name).toBe('marker');
    expect((marker.source as unknown as PostgresTableSource).schema).toBe('prisma_contract');
  });
});
