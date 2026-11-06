#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/4ae263c38bb0abf30b3daf57d2b002997c15260b0e5528bd924969c25f3d00bb/contract';
import endContract from '../../snapshots/4ae263c38bb0abf30b3daf57d2b002997c15260b0e5528bd924969c25f3d00bb/contract.json' with {
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
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('bio', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
