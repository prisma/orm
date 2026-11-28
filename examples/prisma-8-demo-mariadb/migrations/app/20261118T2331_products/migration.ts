#!/usr/bin/env -S node
import {
  col,
  fn,
  lit,
  Migration,
  MigrationCLI,
  primaryKey,
  sql,
} from '@prisma/orm-mariadb/migration';
import type { Contract as End } from '../../snapshots/8f0d2d7e5896ac1ae8e7e479af606f0e1b04b22f2776169d7306c95ba1b9e25c/contract';
import endContract from '../../snapshots/8f0d2d7e5896ac1ae8e7e479af606f0e1b04b22f2776169d7306c95ba1b9e25c/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/80adf21b93f914ac642ac9894d480c41403cca7d5e38c9dc2379796c918d1467/contract';
import startContract from '../../snapshots/80adf21b93f914ac642ac9894d480c41403cca7d5e38c9dc2379796c918d1467/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        table: 'Product',
        columns: [
          col('details', 'json', { notNull: true, codecRef: { codecId: 'mysql/json@1' } }),
          col('id', 'int', {
            notNull: true,
            default: fn(sql`autoincrement()`),
            codecRef: { codecId: 'mysql/int@1' },
          }),
          col('inStock', 'tinyint(1)', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'mysql/boolean@1' },
          }),
          col('name', 'varchar(191)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 191 } },
          }),
          col('notes', 'text', { codecRef: { codecId: 'mysql/text@1' } }),
          col('price', 'decimal(10,2)', {
            notNull: true,
            codecRef: { codecId: 'mysql/decimal@1', typeParams: { precision: 10, scale: 2 } },
          }),
          col('rating', 'double', { notNull: true, codecRef: { codecId: 'mysql/double@1' } }),
          col('sold', 'bigint', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'mysql/bigintnumber@1' },
          }),
          col('thumbnail', 'longblob', {
            notNull: true,
            codecRef: { codecId: 'mysql/longblob@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
