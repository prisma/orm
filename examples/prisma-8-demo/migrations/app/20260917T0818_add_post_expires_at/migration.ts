#!/usr/bin/env -S node
import { col, fn, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/298e207aebb3d05a6a6a6f5a0e5e8b5c02018df72b94a6945c29db19988e3b4c/contract';
import startContract from '../../snapshots/298e207aebb3d05a6a6a6f5a0e5e8b5c02018df72b94a6945c29db19988e3b4c/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/5123f3b3c8f1b62719f0465be6012ec980fe9debf23acd8eecf890ca170c23fb/contract';
import endContract from '../../snapshots/5123f3b3c8f1b62719f0465be6012ec980fe9debf23acd8eecf890ca170c23fb/contract.json' with {
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
