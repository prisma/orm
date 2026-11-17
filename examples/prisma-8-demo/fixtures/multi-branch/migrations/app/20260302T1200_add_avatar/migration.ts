#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/df82ed1c905933192eca7c1d92ac6f1f8ada22d1d712865e5afd4400c554de2e/contract';
import startContract from '../../snapshots/df82ed1c905933192eca7c1d92ac6f1f8ada22d1d712865e5afd4400c554de2e/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/f984b41c72c9ae805561bd27891ef309f95bb5eda852892fc3e37b620f897b38/contract';
import endContract from '../../snapshots/f984b41c72c9ae805561bd27891ef309f95bb5eda852892fc3e37b620f897b38/contract.json' with {
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
