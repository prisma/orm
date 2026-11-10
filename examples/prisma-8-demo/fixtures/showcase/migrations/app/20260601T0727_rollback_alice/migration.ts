#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/76f9a7585ee104f29508fd0ba31f78665ef252d0a42d9d78e1f0ad1ff4dfbe01/contract';
import startContract from '../../snapshots/76f9a7585ee104f29508fd0ba31f78665ef252d0a42d9d78e1f0ad1ff4dfbe01/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/d82c665884d8cf0745edfcc24be8b374ccbe89dffb5e3e6ab10357cad4d5f03f/contract';
import endContract from '../../snapshots/d82c665884d8cf0745edfcc24be8b374ccbe89dffb5e3e6ab10357cad4d5f03f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'name' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'phone' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
