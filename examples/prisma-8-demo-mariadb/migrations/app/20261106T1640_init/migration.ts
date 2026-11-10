#!/usr/bin/env -S node
import {
  col,
  fn,
  Migration,
  MigrationCLI,
  primaryKey,
  sql,
  unique,
} from '@prisma/orm-mariadb/migration';
import type { Contract as End } from '../../snapshots/a79b2f48d08a4ba5bd11c7307b331a418e1f63f4e922bd68fe767b90f28c16c2/contract';
import endContract from '../../snapshots/a79b2f48d08a4ba5bd11c7307b331a418e1f63f4e922bd68fe767b90f28c16c2/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        table: 'Event',
        columns: [
          col('createdAt', 'datetime(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'mysql/datetime@1', typeParams: { precision: 3 } },
          }),
          col('day', 'date', { notNull: true, codecRef: { codecId: 'mysql/date-string@1' } }),
          col('id', 'int', {
            notNull: true,
            default: fn(sql`autoincrement()`),
            codecRef: { codecId: 'mysql/int@1' },
          }),
          col('opensAt', 'time(6)', {
            notNull: true,
            codecRef: { codecId: 'mysql/time-string@1', typeParams: { precision: 6 } },
          }),
          col('startsAt', 'datetime(3)', {
            notNull: true,
            codecRef: { codecId: 'mysql/datetime@1', typeParams: { precision: 3 } },
          }),
          col('title', 'varchar(191)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 191 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        table: 'Post',
        columns: [
          col('authorId', 'int', { notNull: true, codecRef: { codecId: 'mysql/int@1' } }),
          col('id', 'int', {
            notNull: true,
            default: fn(sql`autoincrement()`),
            codecRef: { codecId: 'mysql/int@1' },
          }),
          col('title', 'varchar(191)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 191 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        table: 'User',
        columns: [
          col('email', 'varchar(191)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 191 } },
          }),
          col('id', 'int', {
            notNull: true,
            default: fn(sql`autoincrement()`),
            codecRef: { codecId: 'mysql/int@1' },
          }),
          col('role', "enum('USER','ADMIN')", {
            notNull: true,
            codecRef: { codecId: 'mysql/enum@1', typeParams: { values: ['USER', 'ADMIN'] } },
          }),
        ],
        constraints: [primaryKey(['id']), unique(['email'], { name: 'User_email_key' })],
      }),
      this.createIndex({
        table: 'Post',
        index: 'Post_authorId_idx_e47547ed',
        columns: ['authorId'],
      }),
      this.addForeignKey({
        table: 'Post',
        name: 'Post_authorId_fkey',
        columns: ['authorId'],
        references: { table: 'User', columns: ['id'] },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
