#!/usr/bin/env -S node
import {
  col,
  fn,
  Migration,
  MigrationCLI,
  primaryKey,
  sql,
  unique,
} from '@prisma/orm-mysql/migration';
import type { Contract as End } from '../../snapshots/429ca5218dc113a8f28a4e8890ff6764e9810dff5c9a4c3924969488fb9dbb33/contract';
import endContract from '../../snapshots/429ca5218dc113a8f28a4e8890ff6764e9810dff5c9a4c3924969488fb9dbb33/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
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
