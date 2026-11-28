#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/4ae263c38bb0abf30b3daf57d2b002997c15260b0e5528bd924969c25f3d00bb/contract';
import startContract from '../../snapshots/4ae263c38bb0abf30b3daf57d2b002997c15260b0e5528bd924969c25f3d00bb/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/10cdd020e0f2e31ec61d010c58b77fbed5fae1c1919e21839ba1d2bb82b6aef6/contract';
import endContract from '../../snapshots/10cdd020e0f2e31ec61d010c58b77fbed5fae1c1919e21839ba1d2bb82b6aef6/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('feature', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
