import { createPostgresBuiltinCodecLookup } from '@internal/adapter-postgres/control';
import type { PostgresContract } from '@internal/adapter-postgres/types';
import type { SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import {
  buildControlTableBootstrapQueries,
  buildSignMarkerBootstrapQueries,
} from '@internal/target-postgres/contract-free';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import type { PostgresDdlNode } from '@internal/target-postgres/ddl';
import type { Client } from 'pg';
import { createTestPostgresControlAdapter } from '../../../packages/3-targets/postgres/2-adapter/test/helpers/test-control-adapter';

const postgresControlAdapter = createTestPostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);
const postgresControlLowererContext = { contract: {} as PostgresContract };

export async function executeLoweredStatement(
  client: Client,
  statement: SqlExecuteRequest,
): Promise<void> {
  if (statement.params && statement.params.length > 0) {
    await client.query(statement.sql, [...statement.params]);
    return;
  }
  await client.query(statement.sql);
}

export async function bootstrapPostgresSignMarkerTables(client: Client): Promise<void> {
  for (const query of buildSignMarkerBootstrapQueries()) {
    await executeLoweredStatement(
      client,
      await postgresControlAdapter.lowerToExecuteRequest(
        query as PostgresDdlNode,
        postgresControlLowererContext,
      ),
    );
  }
}

export async function bootstrapPostgresControlSchema(client: Client): Promise<void> {
  const schemaQuery = buildControlTableBootstrapQueries()[0];
  if (!schemaQuery) {
    throw new Error('expected prisma_contract schema bootstrap query');
  }
  await executeLoweredStatement(
    client,
    await postgresControlAdapter.lowerToExecuteRequest(
      schemaQuery as PostgresDdlNode,
      postgresControlLowererContext,
    ),
  );
}

export async function bootstrapPostgresControlTables(client: Client): Promise<void> {
  for (const query of buildControlTableBootstrapQueries()) {
    await executeLoweredStatement(
      client,
      await postgresControlAdapter.lowerToExecuteRequest(
        query as PostgresDdlNode,
        postgresControlLowererContext,
      ),
    );
  }
}
