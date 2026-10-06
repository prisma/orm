#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/2a89d70379cd3a3a349abc0cd39278d70531afd884e29c5b095bed02f0af0955/contract';
import startContract from '../../snapshots/2a89d70379cd3a3a349abc0cd39278d70531afd884e29c5b095bed02f0af0955/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/ad6c8696da69df5c3a46cb752b6e0d53fd10f195b394341513d5f6e9c65e43ac/contract';
import endContract from '../../snapshots/ad6c8696da69df5c3a46cb752b6e0d53fd10f195b394341513d5f6e9c65e43ac/contract.json' with {
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
