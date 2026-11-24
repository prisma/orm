#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/4d880db0165c6d1d5ca2d5e46cd3ed57ad6cac79b1851ba64c2777fd2d289200/contract';
import endContract from '../../snapshots/4d880db0165c6d1d5ca2d5e46cd3ed57ad6cac79b1851ba64c2777fd2d289200/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/312fcf27f836851cf778b23dd90a9605e64a1a62164f39ceadc8022a5580640a/contract';
import startContract from '../../snapshots/312fcf27f836851cf778b23dd90a9605e64a1a62164f39ceadc8022a5580640a/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('bio', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
