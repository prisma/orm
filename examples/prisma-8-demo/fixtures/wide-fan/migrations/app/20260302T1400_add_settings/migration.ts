#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/8efabf1709d15395ac2ec65763fc0990d61dc07834557071280f445c6b989096/contract';
import startContract from '../../snapshots/8efabf1709d15395ac2ec65763fc0990d61dc07834557071280f445c6b989096/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/55e3198344d50be9f561bddc4c8229d9f8ba8242267ff804494984a886c5bd3c/contract';
import endContract from '../../snapshots/55e3198344d50be9f561bddc4c8229d9f8ba8242267ff804494984a886c5bd3c/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('settings', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
