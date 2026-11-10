#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/b0a91f687675c5a96fb07e17b02fbb9ed5b873e2c0152b9985020f24f12a6109/contract';
import endContract from '../../snapshots/b0a91f687675c5a96fb07e17b02fbb9ed5b873e2c0152b9985020f24f12a6109/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/c5aeaafc168786f8e7ac8bb9b14b6469610f67cd640c6f2d289922104545d7a0/contract';
import startContract from '../../snapshots/c5aeaafc168786f8e7ac8bb9b14b6469610f67cd640c6f2d289922104545d7a0/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('comments', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
