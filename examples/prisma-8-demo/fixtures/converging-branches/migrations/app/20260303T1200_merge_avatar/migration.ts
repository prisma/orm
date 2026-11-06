#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/f6b0a58b2f0675a0d020673b1ac1713f6794c66773c1b33e2a2014c6a61f9a06/contract';
import endContract from '../../snapshots/f6b0a58b2f0675a0d020673b1ac1713f6794c66773c1b33e2a2014c6a61f9a06/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/f984b41c72c9ae805561bd27891ef309f95bb5eda852892fc3e37b620f897b38/contract';
import startContract from '../../snapshots/f984b41c72c9ae805561bd27891ef309f95bb5eda852892fc3e37b620f897b38/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('phone', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('posts', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
