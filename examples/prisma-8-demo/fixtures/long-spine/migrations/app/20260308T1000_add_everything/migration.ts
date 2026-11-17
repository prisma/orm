#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/6dbf0d57fcfe6e0235a0dfa6cc07b1162c6f1f7656b281db92a5d7fb522b2e22/contract';
import endContract from '../../snapshots/6dbf0d57fcfe6e0235a0dfa6cc07b1162c6f1f7656b281db92a5d7fb522b2e22/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/f778f751881b602d067b69950a97081f5850d76e8edeee9c16cf14245114224e/contract';
import startContract from '../../snapshots/f778f751881b602d067b69950a97081f5850d76e8edeee9c16cf14245114224e/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('category', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('settings', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
