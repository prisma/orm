#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/53cf82d46a1c1c79995d8ea54e981886bbdce3d4cd9944506960643877c474f5/contract';
import startContract from '../../snapshots/53cf82d46a1c1c79995d8ea54e981886bbdce3d4cd9944506960643877c474f5/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/e1916bd73bb2388302d81a1eaa17125c0cedb6ce47b489a7adeeb41c2ef50ebf/contract';
import endContract from '../../snapshots/e1916bd73bb2388302d81a1eaa17125c0cedb6ce47b489a7adeeb41c2ef50ebf/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'post',
        column: col('body', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'post',
        index: 'post_search_f03270be',
        expression: `(setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B'))`,
        extras: { type: 'gin' },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
