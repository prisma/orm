#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/23371687751c218d354034a564d7709da7ac6af8dd54b37f1a2b9af4e5140073/contract';
import startContract from '../../snapshots/23371687751c218d354034a564d7709da7ac6af8dd54b37f1a2b9af4e5140073/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/f894c02864e197d491f40111ceb9ec48d78de76f4462835c22a3c1f9d68f881f/contract';
import endContract from '../../snapshots/f894c02864e197d491f40111ceb9ec48d78de76f4462835c22a3c1f9d68f881f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('avatar', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
