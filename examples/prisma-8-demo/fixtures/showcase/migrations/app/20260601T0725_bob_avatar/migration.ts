#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/838ff962efc1b2f419ee4f188ebd193b1c10f5e89e9d6e31e90517876ce8239a/contract';
import endContract from '../../snapshots/838ff962efc1b2f419ee4f188ebd193b1c10f5e89e9d6e31e90517876ce8239a/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/f5b8482c8ca961a609b6d8f7d2570b919dad610f2b5299da77aecea246bff2e1/contract';
import startContract from '../../snapshots/f5b8482c8ca961a609b6d8f7d2570b919dad610f2b5299da77aecea246bff2e1/contract.json' with {
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
