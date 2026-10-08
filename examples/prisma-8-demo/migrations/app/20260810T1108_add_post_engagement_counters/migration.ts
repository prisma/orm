#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/703e6150de76c3c7cd1791dc288d36c371c8c0c3cf42ca47c02c3cc31dacf051/contract';
import endContract from '../../snapshots/703e6150de76c3c7cd1791dc288d36c371c8c0c3cf42ca47c02c3cc31dacf051/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/f442c3a7391029f4bb4b5e0f078c4164ffb2e69f8a9e423b2b7588b5249c8b25/contract';
import startContract from '../../snapshots/f442c3a7391029f4bb4b5e0f078c4164ffb2e69f8a9e423b2b7588b5249c8b25/contract.json' with {
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
