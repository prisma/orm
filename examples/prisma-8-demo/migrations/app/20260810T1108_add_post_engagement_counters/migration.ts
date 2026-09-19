#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/8abaa3b97115767c5fee67bcd90de0cec3ac1f14a59875c2f5d22887ba435f89/contract';
import endContract from '../../snapshots/8abaa3b97115767c5fee67bcd90de0cec3ac1f14a59875c2f5d22887ba435f89/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/f62a4154d0b48cb144ca4f74667fc6922e770f81edd5517393285fb92d07dddc/contract';
import startContract from '../../snapshots/f62a4154d0b48cb144ca4f74667fc6922e770f81edd5517393285fb92d07dddc/contract.json' with {
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
        column: col('impressionCount', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'post',
        column: col('reachScore', 'numeric', { codecRef: { codecId: 'pg/unboundedint@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'post',
        column: col('viewCount', 'int8', { codecRef: { codecId: 'pg/int8number@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
