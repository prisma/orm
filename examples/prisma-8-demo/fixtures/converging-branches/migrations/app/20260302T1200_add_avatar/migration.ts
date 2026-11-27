#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/7a82efb1295ef535d27c13b7b884bd917830f82b8bd44d3f0ec7c788e8556e5f/contract';
import endContract from '../../snapshots/7a82efb1295ef535d27c13b7b884bd917830f82b8bd44d3f0ec7c788e8556e5f/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/61b0977c9b9d853a6a9c92516a66c11b4b60824f0a39386c733206093cbb09c3/contract';
import startContract from '../../snapshots/61b0977c9b9d853a6a9c92516a66c11b4b60824f0a39386c733206093cbb09c3/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('avatar', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
