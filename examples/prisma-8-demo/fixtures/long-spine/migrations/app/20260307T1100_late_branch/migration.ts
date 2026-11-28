#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/098bf8d1006ad2f6cc9484fc3383ba913f27e643d690f2d24b99a51030f13415/contract';
import startContract from '../../snapshots/098bf8d1006ad2f6cc9484fc3383ba913f27e643d690f2d24b99a51030f13415/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/cd2f01a85dc8d8d3538242fdf4267b5b3116bb4c02cb2ff56fa0f4a4f5d3f00e/contract';
import endContract from '../../snapshots/cd2f01a85dc8d8d3538242fdf4267b5b3116bb4c02cb2ff56fa0f4a4f5d3f00e/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('category', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
