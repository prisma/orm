#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/65af8014ce1fb6fd29c62e1389919df7f656a5675e4c9475cd67656557278d60/contract';
import endContract from '../../snapshots/65af8014ce1fb6fd29c62e1389919df7f656a5675e4c9475cd67656557278d60/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/eebc10206a16b7203efeaebe0db58d07267db0d76babaf21a3d8feef9357cf09/contract';
import startContract from '../../snapshots/eebc10206a16b7203efeaebe0db58d07267db0d76babaf21a3d8feef9357cf09/contract.json' with {
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
