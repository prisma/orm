#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/0cc3858331779e3853a61a911a7fe85ca764430aa9de12c2a0bb36bfa3165743/contract';
import endContract from '../../snapshots/0cc3858331779e3853a61a911a7fe85ca764430aa9de12c2a0bb36bfa3165743/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/1f8be6858951202dbb1dfad2a36b45f3d04c630d2577dd70ac02f55bcb8ca5ea/contract';
import startContract from '../../snapshots/1f8be6858951202dbb1dfad2a36b45f3d04c630d2577dd70ac02f55bcb8ca5ea/contract.json' with {
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
