#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/contract';
import startContract from '../../snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/f6b0a58b2f0675a0d020673b1ac1713f6794c66773c1b33e2a2014c6a61f9a06/contract';
import endContract from '../../snapshots/f6b0a58b2f0675a0d020673b1ac1713f6794c66773c1b33e2a2014c6a61f9a06/contract.json' with {
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
