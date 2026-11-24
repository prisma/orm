#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/312fcf27f836851cf778b23dd90a9605e64a1a62164f39ceadc8022a5580640a/contract';
import endContract from '../../snapshots/312fcf27f836851cf778b23dd90a9605e64a1a62164f39ceadc8022a5580640a/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/dfe9c3c7016ae2b495e0728d4599c0f5bf9833951a99ab2c3c94074e53093de3/contract';
import startContract from '../../snapshots/dfe9c3c7016ae2b495e0728d4599c0f5bf9833951a99ab2c3c94074e53093de3/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('avatar', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('name', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('phone', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
