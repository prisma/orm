#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/4b5fe535f5f057cb7fd22cdbaf45d3ef04e638e1fcb5c35f2fe2ab49a1dd2f2d/contract';
import startContract from '../../snapshots/4b5fe535f5f057cb7fd22cdbaf45d3ef04e638e1fcb5c35f2fe2ab49a1dd2f2d/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/298e207aebb3d05a6a6a6f5a0e5e8b5c02018df72b94a6945c29db19988e3b4c/contract';
import endContract from '../../snapshots/298e207aebb3d05a6a6a6f5a0e5e8b5c02018df72b94a6945c29db19988e3b4c/contract.json' with {
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
