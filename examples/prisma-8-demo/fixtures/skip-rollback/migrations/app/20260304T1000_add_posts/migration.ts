#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/4ae263c38bb0abf30b3daf57d2b002997c15260b0e5528bd924969c25f3d00bb/contract';
import startContract from '../../snapshots/4ae263c38bb0abf30b3daf57d2b002997c15260b0e5528bd924969c25f3d00bb/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/3539138011365388d750c8a37a053403de07308eb1d872451a33d9655c9f1dde/contract';
import endContract from '../../snapshots/3539138011365388d750c8a37a053403de07308eb1d872451a33d9655c9f1dde/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('posts', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
