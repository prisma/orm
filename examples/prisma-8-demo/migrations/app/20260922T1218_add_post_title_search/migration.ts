#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/06b2dc7bf45a1c5bf00ae3a80653b88fc0146101673e2a029b2c7db290833284/contract';
import endContract from '../../snapshots/06b2dc7bf45a1c5bf00ae3a80653b88fc0146101673e2a029b2c7db290833284/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/62d81d607d929760f7d740b45bb97acc1dba361363c4851b19ee5a1cb4fecbe3/contract';
import startContract from '../../snapshots/62d81d607d929760f7d740b45bb97acc1dba361363c4851b19ee5a1cb4fecbe3/contract.json' with {
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
        index: 'post_title_search_724b05e5',
        expression: 'to_tsvector(\'english\', "title")',
        extras: { type: 'gin' },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
