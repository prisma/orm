#!/usr/bin/env -S node
import { col, fn, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/705398c87a4f2c7e2ac0a49002b9061963f726b8875ffe53da1feac8df00b040/contract';
import endContract from '../../snapshots/705398c87a4f2c7e2ac0a49002b9061963f726b8875ffe53da1feac8df00b040/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/db733e1df89f66886f7dd6a2ea54fc5be48e65d81aadd193d1e7f220ccf14f5e/contract';
import startContract from '../../snapshots/db733e1df89f66886f7dd6a2ea54fc5be48e65d81aadd193d1e7f220ccf14f5e/contract.json' with {
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
