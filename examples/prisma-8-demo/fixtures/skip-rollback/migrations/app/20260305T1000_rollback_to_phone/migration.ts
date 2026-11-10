#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/contract';
import endContract from '../../snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/3539138011365388d750c8a37a053403de07308eb1d872451a33d9655c9f1dde/contract';
import startContract from '../../snapshots/3539138011365388d750c8a37a053403de07308eb1d872451a33d9655c9f1dde/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'bio' }),
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'posts' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
