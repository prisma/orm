#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/62d81d607d929760f7d740b45bb97acc1dba361363c4851b19ee5a1cb4fecbe3/contract';
import startContract from '../../snapshots/62d81d607d929760f7d740b45bb97acc1dba361363c4851b19ee5a1cb4fecbe3/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/444e34907b8aba319bb33de7767af222b4a31f9c5361aed1c4bdf9eb951232de/contract';
import endContract from '../../snapshots/444e34907b8aba319bb33de7767af222b4a31f9c5361aed1c4bdf9eb951232de/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'post',
        index: 'post_title_search_1c180f5a',
        expression: 'to_tsvector(\'english\', "title")',
        extras: { type: 'gin' },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
