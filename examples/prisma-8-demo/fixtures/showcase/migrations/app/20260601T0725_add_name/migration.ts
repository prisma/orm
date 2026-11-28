#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/6c01c7bf566e073fc66946ed1890f9825cbd37707435b19f0aab4b6e46c2604e/contract';
import startContract from '../../snapshots/6c01c7bf566e073fc66946ed1890f9825cbd37707435b19f0aab4b6e46c2604e/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/f5b8482c8ca961a609b6d8f7d2570b919dad610f2b5299da77aecea246bff2e1/contract';
import endContract from '../../snapshots/f5b8482c8ca961a609b6d8f7d2570b919dad610f2b5299da77aecea246bff2e1/contract.json' with {
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
