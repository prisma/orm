#!/usr/bin/env -S node
import { col, Migration, MigrationCLI, primaryKey } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/dfe9c3c7016ae2b495e0728d4599c0f5bf9833951a99ab2c3c94074e53093de3/contract';
import endContract from '../../snapshots/dfe9c3c7016ae2b495e0728d4599c0f5bf9833951a99ab2c3c94074e53093de3/contract.json' with {
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
