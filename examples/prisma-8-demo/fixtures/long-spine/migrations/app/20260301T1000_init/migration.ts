#!/usr/bin/env -S node
import { col, Migration, MigrationCLI, primaryKey } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/8efabf1709d15395ac2ec65763fc0990d61dc07834557071280f445c6b989096/contract';
import endContract from '../../snapshots/8efabf1709d15395ac2ec65763fc0990d61dc07834557071280f445c6b989096/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        table: 'user',
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
