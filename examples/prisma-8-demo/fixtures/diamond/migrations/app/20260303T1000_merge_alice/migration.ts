#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/20d64af2b9029298c93a8847aa9a2b8f790ea2ddc923beab3aa96ec86c449671/contract';
import endContract from '../../snapshots/20d64af2b9029298c93a8847aa9a2b8f790ea2ddc923beab3aa96ec86c449671/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/ff745362b097d2c6a45dac30c7679674557f0d02bf9e8de489f29fa83c773deb/contract';
import startContract from '../../snapshots/ff745362b097d2c6a45dac30c7679674557f0d02bf9e8de489f29fa83c773deb/contract.json' with {
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
