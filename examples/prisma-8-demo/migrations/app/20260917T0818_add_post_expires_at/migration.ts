#!/usr/bin/env -S node
import { col, fn, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/7813b695f54859f50a2fbff911e90d8944d4137d58b9cb698f72d94bf0b4dfcf/contract';
import endContract from '../../snapshots/7813b695f54859f50a2fbff911e90d8944d4137d58b9cb698f72d94bf0b4dfcf/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/e30df674ee42a959202fc4664628b2e22e0889a4062458d221f4156673218911/contract';
import startContract from '../../snapshots/e30df674ee42a959202fc4664628b2e22e0889a4062458d221f4156673218911/contract.json' with {
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
