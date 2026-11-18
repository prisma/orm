#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/contract';
import endContract from '../../snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/df82ed1c905933192eca7c1d92ac6f1f8ada22d1d712865e5afd4400c554de2e/contract';
import startContract from '../../snapshots/df82ed1c905933192eca7c1d92ac6f1f8ada22d1d712865e5afd4400c554de2e/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('phone', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
