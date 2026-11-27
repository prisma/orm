#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/7a82efb1295ef535d27c13b7b884bd917830f82b8bd44d3f0ec7c788e8556e5f/contract';
import startContract from '../../snapshots/7a82efb1295ef535d27c13b7b884bd917830f82b8bd44d3f0ec7c788e8556e5f/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/20d64af2b9029298c93a8847aa9a2b8f790ea2ddc923beab3aa96ec86c449671/contract';
import endContract from '../../snapshots/20d64af2b9029298c93a8847aa9a2b8f790ea2ddc923beab3aa96ec86c449671/contract.json' with {
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
