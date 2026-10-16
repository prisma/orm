#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/269d0430c7c70fa502e75feb52d9219c0339daa041c6cc9fb4ecb5ad8d0373b6/contract';
import startContract from '../../snapshots/269d0430c7c70fa502e75feb52d9219c0339daa041c6cc9fb4ecb5ad8d0373b6/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/ab4b37f4e30e5935f5e9dc3b6cffb6fca4827e975950a41dfe30a10ed89f5cc3/contract';
import endContract from '../../snapshots/ab4b37f4e30e5935f5e9dc3b6cffb6fca4827e975950a41dfe30a10ed89f5cc3/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'telemetry_event',
        column: col('exitCode', 'int4'),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
