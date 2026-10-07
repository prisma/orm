#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/76f9a7585ee104f29508fd0ba31f78665ef252d0a42d9d78e1f0ad1ff4dfbe01/contract';
import endContract from '../../snapshots/76f9a7585ee104f29508fd0ba31f78665ef252d0a42d9d78e1f0ad1ff4dfbe01/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/23371687751c218d354034a564d7709da7ac6af8dd54b37f1a2b9af4e5140073/contract';
import startContract from '../../snapshots/23371687751c218d354034a564d7709da7ac6af8dd54b37f1a2b9af4e5140073/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('phone', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
