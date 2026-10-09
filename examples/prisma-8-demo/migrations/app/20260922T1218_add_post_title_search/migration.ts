#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/1f8be6858951202dbb1dfad2a36b45f3d04c630d2577dd70ac02f55bcb8ca5ea/contract';
import endContract from '../../snapshots/1f8be6858951202dbb1dfad2a36b45f3d04c630d2577dd70ac02f55bcb8ca5ea/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/8f4f91b9f5f1ebaa44af146535cbc2875e282d7f034d8d61a385b3dace6c15bf/contract';
import startContract from '../../snapshots/8f4f91b9f5f1ebaa44af146535cbc2875e282d7f034d8d61a385b3dace6c15bf/contract.json' with {
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
