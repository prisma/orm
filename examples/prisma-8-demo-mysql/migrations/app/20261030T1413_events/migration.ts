#!/usr/bin/env -S node
import { col, fn, Migration, MigrationCLI, primaryKey, sql } from '@prisma/orm-mysql/migration';
import type { Contract as Start } from '../../snapshots/429ca5218dc113a8f28a4e8890ff6764e9810dff5c9a4c3924969488fb9dbb33/contract';
import startContract from '../../snapshots/429ca5218dc113a8f28a4e8890ff6764e9810dff5c9a4c3924969488fb9dbb33/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/e5204ea7419455b72c116d69a1487d13716cb36a17aaf355fd880275065a9a23/contract';
import endContract from '../../snapshots/e5204ea7419455b72c116d69a1487d13716cb36a17aaf355fd880275065a9a23/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
