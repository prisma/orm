#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/80d8e670476938a92ad80b9db3eab25f6f2f72ee390aaff9b27bb6d505d27bbd/contract';
import endContract from '../../snapshots/80d8e670476938a92ad80b9db3eab25f6f2f72ee390aaff9b27bb6d505d27bbd/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/904f3936c51982a81a637651ab70fb82800f2cba5477b768ad1b531d76ae7517/contract';
import startContract from '../../snapshots/904f3936c51982a81a637651ab70fb82800f2cba5477b768ad1b531d76ae7517/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'widget', column: col('count', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
