#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/3f6bf710feaac5efdc9d00b5840c97a9087ec587a1b3dfe652d96791db397e4c/contract';
import endContract from '../../snapshots/3f6bf710feaac5efdc9d00b5840c97a9087ec587a1b3dfe652d96791db397e4c/contract.json' with {
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
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('posts', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
