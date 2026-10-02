#!/usr/bin/env -S node
import { col, fn, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/2a89d70379cd3a3a349abc0cd39278d70531afd884e29c5b095bed02f0af0955/contract';
import endContract from '../../snapshots/2a89d70379cd3a3a349abc0cd39278d70531afd884e29c5b095bed02f0af0955/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/b601a01134fe52b77d235b926df687360b3fbc46867ddf9cffdb0b909f812ebc/contract';
import startContract from '../../snapshots/b601a01134fe52b77d235b926df687360b3fbc46867ddf9cffdb0b909f812ebc/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'post',
        column: col('expiresAt', 'timestamptz', {
          notNull: true,
          default: fn("(now() + '7 days'::interval)"),
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
