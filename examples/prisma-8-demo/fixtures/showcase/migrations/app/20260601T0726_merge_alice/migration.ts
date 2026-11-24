#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/312fcf27f836851cf778b23dd90a9605e64a1a62164f39ceadc8022a5580640a/contract';
import endContract from '../../snapshots/312fcf27f836851cf778b23dd90a9605e64a1a62164f39ceadc8022a5580640a/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/241635fcf8563b1a928d8bc2a6edc8935acf07bca77432a0ff41cd23a48b3ad4/contract';
import startContract from '../../snapshots/241635fcf8563b1a928d8bc2a6edc8935acf07bca77432a0ff41cd23a48b3ad4/contract.json' with {
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
