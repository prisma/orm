#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/98be62e0c5711625de733271c742624072d23537ea95d2521f68424ebdddf422/contract';
import endContract from '../../snapshots/98be62e0c5711625de733271c742624072d23537ea95d2521f68424ebdddf422/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/7813b695f54859f50a2fbff911e90d8944d4137d58b9cb698f72d94bf0b4dfcf/contract';
import startContract from '../../snapshots/7813b695f54859f50a2fbff911e90d8944d4137d58b9cb698f72d94bf0b4dfcf/contract.json' with {
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
        index: 'post_title_search_e0dd1131',
        expression: 'to_tsvector(\'english\', "title")',
        extras: { type: 'gin' },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
