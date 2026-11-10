#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/23371687751c218d354034a564d7709da7ac6af8dd54b37f1a2b9af4e5140073/contract';
import endContract from '../../snapshots/23371687751c218d354034a564d7709da7ac6af8dd54b37f1a2b9af4e5140073/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/d82c665884d8cf0745edfcc24be8b374ccbe89dffb5e3e6ab10357cad4d5f03f/contract';
import startContract from '../../snapshots/d82c665884d8cf0745edfcc24be8b374ccbe89dffb5e3e6ab10357cad4d5f03f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('name', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
