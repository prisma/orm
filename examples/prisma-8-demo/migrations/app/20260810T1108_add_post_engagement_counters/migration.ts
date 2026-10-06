#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/b601a01134fe52b77d235b926df687360b3fbc46867ddf9cffdb0b909f812ebc/contract';
import endContract from '../../snapshots/b601a01134fe52b77d235b926df687360b3fbc46867ddf9cffdb0b909f812ebc/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/f865f3034901be5195a6e7c30b3832daa8bea2684457d29d9c7e9cff2e230aba/contract';
import startContract from '../../snapshots/f865f3034901be5195a6e7c30b3832daa8bea2684457d29d9c7e9cff2e230aba/contract.json' with {
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
