import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { buildSignMarkerBootstrapQueries } from '@internal/target-postgres/contract-free';
import type { PostgresDdlNode } from '@internal/target-postgres/ddl';
import { describe, expect, test } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';
import type { PostgresContract } from '../../src/core/types';

describe('Postgres marker table DDL lowering', () => {
  const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
  const lowererContext = { contract: {} as PostgresContract };

  async function markerTableSql(): Promise<string> {
    const queries = buildSignMarkerBootstrapQueries();
    const markerTable = queries[1];
    if (!markerTable) {
      throw new Error('expected marker table bootstrap query');
    }
    return (await adapter.lowerToExecuteRequest(markerTable as PostgresDdlNode, lowererContext))
      .sql;
  }

  test('declares the invariants column as text[] not null default empty array', async () => {
    expect(await markerTableSql()).toContain(`"invariants" text[] DEFAULT '{}'::text[] NOT NULL`);
  });

  test('keys the marker by `space text` (PRIMARY KEY) instead of the legacy single-row `id`', async () => {
    expect(await markerTableSql()).toMatch(/"space"\s+text\b/);
    expect(await markerTableSql()).toMatch(
      /"space"\s+text\b.*NOT NULL.*PRIMARY KEY|PRIMARY KEY\s*\(\s*"space"\s*\)/,
    );
  });

  test('does not declare a legacy `id smallint` primary-key column', async () => {
    expect(await markerTableSql()).not.toMatch(/id\s+smallint/i);
  });
});
