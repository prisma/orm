#!/usr/bin/env -S node
import { col, fn, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/8abaa3b97115767c5fee67bcd90de0cec3ac1f14a59875c2f5d22887ba435f89/contract';
import startContract from '../../snapshots/8abaa3b97115767c5fee67bcd90de0cec3ac1f14a59875c2f5d22887ba435f89/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/62d81d607d929760f7d740b45bb97acc1dba361363c4851b19ee5a1cb4fecbe3/contract';
import endContract from '../../snapshots/62d81d607d929760f7d740b45bb97acc1dba361363c4851b19ee5a1cb4fecbe3/contract.json' with {
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
