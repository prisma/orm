#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/2268a4dd377c4a238d1c8d5fada0056356d753619b26472c10cb1d258d7cea77/contract';
import endContract from '../../snapshots/2268a4dd377c4a238d1c8d5fada0056356d753619b26472c10cb1d258d7cea77/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/b1643ad5e63c8896f80a44f59430cefd17a44554e3b5458121bf1bc87a89bbc0/contract';
import startContract from '../../snapshots/b1643ad5e63c8896f80a44f59430cefd17a44554e3b5458121bf1bc87a89bbc0/contract.json' with {
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
