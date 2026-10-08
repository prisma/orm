#!/usr/bin/env -S node
import { col, fn, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/8f4f91b9f5f1ebaa44af146535cbc2875e282d7f034d8d61a385b3dace6c15bf/contract';
import endContract from '../../snapshots/8f4f91b9f5f1ebaa44af146535cbc2875e282d7f034d8d61a385b3dace6c15bf/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/703e6150de76c3c7cd1791dc288d36c371c8c0c3cf42ca47c02c3cc31dacf051/contract';
import startContract from '../../snapshots/703e6150de76c3c7cd1791dc288d36c371c8c0c3cf42ca47c02c3cc31dacf051/contract.json' with {
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
