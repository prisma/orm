#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/b0a91f687675c5a96fb07e17b02fbb9ed5b873e2c0152b9985020f24f12a6109/contract';
import startContract from '../../snapshots/b0a91f687675c5a96fb07e17b02fbb9ed5b873e2c0152b9985020f24f12a6109/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/f778f751881b602d067b69950a97081f5850d76e8edeee9c16cf14245114224e/contract';
import endContract from '../../snapshots/f778f751881b602d067b69950a97081f5850d76e8edeee9c16cf14245114224e/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('tags', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
