#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/45a4bda0610016587aaffcc3f01841890e4bd13e9f4214b841ab8652ef078645/contract';
import endContract from '../../snapshots/45a4bda0610016587aaffcc3f01841890e4bd13e9f4214b841ab8652ef078645/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/525867e53b3d9a4667d113111afb4674fec9e9fd6fd2283321bb3593fbaf0b0f/contract';
import startContract from '../../snapshots/525867e53b3d9a4667d113111afb4674fec9e9fd6fd2283321bb3593fbaf0b0f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('category', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('settings', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
