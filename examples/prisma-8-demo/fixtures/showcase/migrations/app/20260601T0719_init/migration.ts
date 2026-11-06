#!/usr/bin/env -S node
import { col, Migration, MigrationCLI, primaryKey } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/d82c665884d8cf0745edfcc24be8b374ccbe89dffb5e3e6ab10357cad4d5f03f/contract';
import endContract from '../../snapshots/d82c665884d8cf0745edfcc24be8b374ccbe89dffb5e3e6ab10357cad4d5f03f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        table: 'account',
        columns: [
          col('email', 'text', { notNull: true }),
          col('id', 'character(36)', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
