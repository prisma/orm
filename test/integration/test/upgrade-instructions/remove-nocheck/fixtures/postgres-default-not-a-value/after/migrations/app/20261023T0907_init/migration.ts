#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a999786aa6cf78a5930731256ba2125153d5a33f344d5cb7ac96af664e181b4f/contract';
import endContract from '../../snapshots/a999786aa6cf78a5930731256ba2125153d5a33f344d5cb7ac96af664e181b4f/contract.json' with {
  type: 'json',
};
import { Migration, MigrationCLI, col, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'product',
        columns: [
          col('addedAt', 'timestamptz', {
            notNull: true,
            default: lit('2024-01-01T00:00:00Z'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('opensAt', 'time', {
            notNull: true,
            default: lit('12:34:00.1234567'),
            codecRef: { codecId: 'pg/time-temporal@1' },
          }),
          col('price', 'numeric(10,2)', {
            notNull: true,
            default: lit('1.5'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 10, scale: 2 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
