#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/8f4f91b9f5f1ebaa44af146535cbc2875e282d7f034d8d61a385b3dace6c15bf/contract';
import startContract from '../../snapshots/8f4f91b9f5f1ebaa44af146535cbc2875e282d7f034d8d61a385b3dace6c15bf/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/e6ffcff32f45de18e469df15dab64a2436682c3bfdbf62fd8b3a74d35e40014d/contract';
import endContract from '../../snapshots/e6ffcff32f45de18e469df15dab64a2436682c3bfdbf62fd8b3a74d35e40014d/contract.json' with {
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
