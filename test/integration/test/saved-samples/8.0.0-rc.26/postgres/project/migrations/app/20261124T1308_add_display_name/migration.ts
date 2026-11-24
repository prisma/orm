#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/55cd844d8863b4f8651a03add82462a844a9f35a4d9740cb55c910e9e7ad2408/contract';
import startContract from '../../snapshots/55cd844d8863b4f8651a03add82462a844a9f35a4d9740cb55c910e9e7ad2408/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ca21ea32b59b3a7f9e4f7ec0305ffb05d788236e80b3f278add2574036b5159d/contract';
import { Migration, MigrationCLI, col, placeholder } from '@internal/postgres/migration';

import endContractJson from '../../snapshots/ca21ea32b59b3a7f9e4f7ec0305ffb05d788236e80b3f278add2574036b5159d/contract.json' with { type: 'json' };
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { sql as sqlBuilder } from '@internal/sql-builder/runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import pgvector from '@internal/extension-pgvector/runtime';

const endContract = new PostgresContractSerializer().deserializeContract(endContractJson);

const db = sqlBuilder({
  context: createExecutionContext({
    contract: endContract,
    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter, extensions: [pgvector] }),
  }),
});
export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('displayName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dataTransform(endContract, 'backfill-user-displayName', {
        backfillsColumn: { schema: 'public', table: 'user', column: 'displayName' },
        check: () => db.public.user.select('id').where((f, fns) => fns.eq(f.displayName, null)).limit(1),
        run: () => db.public.user.update({ displayName: 'unnamed' }).where((f, fns) => fns.eq(f.displayName, null)),
      }),
      this.setNotNull({ schema: 'public', table: 'user', column: 'displayName' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
