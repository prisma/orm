#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/d5fdae79e33040f9cc33f8c56b9a65f1ce1f86d941198f9d6281abe88d762a55/contract';
import endContract from '../../snapshots/d5fdae79e33040f9cc33f8c56b9a65f1ce1f86d941198f9d6281abe88d762a55/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/f778f751881b602d067b69950a97081f5850d76e8edeee9c16cf14245114224e/contract';
import startContract from '../../snapshots/f778f751881b602d067b69950a97081f5850d76e8edeee9c16cf14245114224e/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('category', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
