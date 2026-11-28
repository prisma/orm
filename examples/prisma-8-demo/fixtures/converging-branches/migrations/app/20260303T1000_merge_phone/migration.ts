#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/e37e08cbc24b1addd441ab99f441f66c20c640ddfc51ed95b4ed3e4b3d71a0be/contract';
import endContract from '../../snapshots/e37e08cbc24b1addd441ab99f441f66c20c640ddfc51ed95b4ed3e4b3d71a0be/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/ff745362b097d2c6a45dac30c7679674557f0d02bf9e8de489f29fa83c773deb/contract';
import startContract from '../../snapshots/ff745362b097d2c6a45dac30c7679674557f0d02bf9e8de489f29fa83c773deb/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('avatar', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('posts', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
