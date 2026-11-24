#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/8efabf1709d15395ac2ec65763fc0990d61dc07834557071280f445c6b989096/contract';
import startContract from '../../snapshots/8efabf1709d15395ac2ec65763fc0990d61dc07834557071280f445c6b989096/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/eebc10206a16b7203efeaebe0db58d07267db0d76babaf21a3d8feef9357cf09/contract';
import endContract from '../../snapshots/eebc10206a16b7203efeaebe0db58d07267db0d76babaf21a3d8feef9357cf09/contract.json' with {
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
