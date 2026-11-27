#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/6e8d4fbe3c1a65998f0de7082b9296c742a027b57c51c8e567177f3e69151f32/contract';
import endContract from '../../snapshots/6e8d4fbe3c1a65998f0de7082b9296c742a027b57c51c8e567177f3e69151f32/contract.json' with {
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
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('settings', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
