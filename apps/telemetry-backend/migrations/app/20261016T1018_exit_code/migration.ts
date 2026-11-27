#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/63d3e6e892a4f2d8a1cbd6887aad9111841663597f16f92a1bd5e4f6069785c1/contract';
import startContract from '../../snapshots/63d3e6e892a4f2d8a1cbd6887aad9111841663597f16f92a1bd5e4f6069785c1/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/530977751cbf6f302d7e43f88bd920c2357668b5b956454bcf4f3804e996743b/contract';
import endContract from '../../snapshots/530977751cbf6f302d7e43f88bd920c2357668b5b956454bcf4f3804e996743b/contract.json' with {
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
