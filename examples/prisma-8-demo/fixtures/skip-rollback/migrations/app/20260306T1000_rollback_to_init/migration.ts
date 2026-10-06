#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/4ae263c38bb0abf30b3daf57d2b002997c15260b0e5528bd924969c25f3d00bb/contract';
import startContract from '../../snapshots/4ae263c38bb0abf30b3daf57d2b002997c15260b0e5528bd924969c25f3d00bb/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/df82ed1c905933192eca7c1d92ac6f1f8ada22d1d712865e5afd4400c554de2e/contract';
import endContract from '../../snapshots/df82ed1c905933192eca7c1d92ac6f1f8ada22d1d712865e5afd4400c554de2e/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'bio' }),
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'phone' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
