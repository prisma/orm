#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/71947ab1c58924051819079568facc696eca0ce0bb455e512ec35e59a7fa5037/contract';
import endContract from '../../snapshots/71947ab1c58924051819079568facc696eca0ce0bb455e512ec35e59a7fa5037/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/bda6fbb661bd861019340b85c633c1748e7973917a35f552089e758731adfda4/contract';
import startContract from '../../snapshots/bda6fbb661bd861019340b85c633c1748e7973917a35f552089e758731adfda4/contract.json' with {
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
