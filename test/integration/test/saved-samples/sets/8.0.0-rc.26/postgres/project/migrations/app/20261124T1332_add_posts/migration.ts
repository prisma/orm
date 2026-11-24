#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/55cd844d8863b4f8651a03add82462a844a9f35a4d9740cb55c910e9e7ad2408/contract';
import endContract from '../../snapshots/55cd844d8863b4f8651a03add82462a844a9f35a4d9740cb55c910e9e7ad2408/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6bb8e6bebc413fbd0a6f203079c61a9979c89d9df48f97e9f6718da05fbe4549/contract';
import startContract from '../../snapshots/6bb8e6bebc413fbd0a6f203079c61a9979c89d9df48f97e9f6718da05fbe4549/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@internal/postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'post',
        columns: [
          col('authorId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'post',
        index: 'post_authorId_idx_e47547ed',
        columns: ['authorId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'post',
        foreignKey: {
          name: 'post_authorId_fkey',
          columns: ['authorId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
