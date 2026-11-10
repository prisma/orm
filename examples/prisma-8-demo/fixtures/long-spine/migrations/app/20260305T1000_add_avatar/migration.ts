#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/3539138011365388d750c8a37a053403de07308eb1d872451a33d9655c9f1dde/contract';
import startContract from '../../snapshots/3539138011365388d750c8a37a053403de07308eb1d872451a33d9655c9f1dde/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/c5aeaafc168786f8e7ac8bb9b14b6469610f67cd640c6f2d289922104545d7a0/contract';
import endContract from '../../snapshots/c5aeaafc168786f8e7ac8bb9b14b6469610f67cd640c6f2d289922104545d7a0/contract.json' with {
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
