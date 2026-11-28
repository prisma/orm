#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/3c4b61663c42cb5d0ef688469c3a7d10c0482dca391e90c897873593336e452e/contract';
import startContract from '../../snapshots/3c4b61663c42cb5d0ef688469c3a7d10c0482dca391e90c897873593336e452e/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/e30df674ee42a959202fc4664628b2e22e0889a4062458d221f4156673218911/contract';
import endContract from '../../snapshots/e30df674ee42a959202fc4664628b2e22e0889a4062458d221f4156673218911/contract.json' with {
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
