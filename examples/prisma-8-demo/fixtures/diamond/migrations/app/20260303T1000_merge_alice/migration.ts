#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/6b4636f85cc2d7b2f8d4a70bd2c520246b4bbe786aa55d3b77592fae5c4d458f/contract';
import endContract from '../../snapshots/6b4636f85cc2d7b2f8d4a70bd2c520246b4bbe786aa55d3b77592fae5c4d458f/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/contract';
import startContract from '../../snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/contract.json' with {
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
