#!/usr/bin/env -S node
import { col, Migration, MigrationCLI, primaryKey } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/df82ed1c905933192eca7c1d92ac6f1f8ada22d1d712865e5afd4400c554de2e/contract';
import endContract from '../../snapshots/df82ed1c905933192eca7c1d92ac6f1f8ada22d1d712865e5afd4400c554de2e/contract.json' with {
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
