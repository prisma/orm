#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/6f1bca1d17a471cc49aea3c186f6d9502843abedd4e8bf82744f6f4c918deeb9/contract';
import endContract from '../../snapshots/6f1bca1d17a471cc49aea3c186f6d9502843abedd4e8bf82744f6f4c918deeb9/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/98be62e0c5711625de733271c742624072d23537ea95d2521f68424ebdddf422/contract';
import startContract from '../../snapshots/98be62e0c5711625de733271c742624072d23537ea95d2521f68424ebdddf422/contract.json' with {
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
