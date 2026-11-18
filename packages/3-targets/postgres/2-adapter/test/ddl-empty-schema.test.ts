import { col } from '@internal/sql-relational-core/contract-free';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createTable } from '@internal/target-postgres/contract-free';
import {
  createPostgresBuiltinDataTypeLookup,
  postgresDataTypes,
} from '@internal/target-postgres/data-types';
import { PostgresCreateType, PostgresDropType } from '@internal/target-postgres/ddl';
import { AddColumnCall, DropDefaultCall } from '@internal/target-postgres/op-factory-call';
import { describe, expect, it } from 'vitest';
import { createTestPostgresControlAdapter } from './helpers/test-control-adapter';

const adapter = createTestPostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);

const refusal = { code: 'CONTRACT.IDENTIFIER_INVALID' };

describe('an empty schema name', () => {
  it('is refused by CREATE TABLE, CREATE TYPE and DROP TYPE', async () => {
    await expect(
      adapter.lowerToExecuteRequest(
        createTable({ schema: '', table: 't', columns: [col('a', 'int4')] }),
      ),
    ).rejects.toMatchObject(refusal);
    await expect(
      adapter.lowerToExecuteRequest(
        new PostgresCreateType({ schema: '', name: 'mood', values: ['a'] }),
      ),
    ).rejects.toMatchObject(refusal);
    await expect(
      adapter.lowerToExecuteRequest(new PostgresDropType({ schema: '', name: 'mood' })),
    ).rejects.toMatchObject(refusal);
  });

  it('is refused when a migration adds a column or drops a default', async () => {
    await expect(
      new AddColumnCall('', 't', col('a', 'int4'), postgresDataTypes).toOp(adapter),
    ).rejects.toMatchObject(refusal);
    await expect(new DropDefaultCall('', 't', 'a').toOp(adapter)).rejects.toMatchObject(refusal);
  });
});
