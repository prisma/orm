#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/53cf82d46a1c1c79995d8ea54e981886bbdce3d4cd9944506960643877c474f5/contract';
import endContract from '../../snapshots/53cf82d46a1c1c79995d8ea54e981886bbdce3d4cd9944506960643877c474f5/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/705398c87a4f2c7e2ac0a49002b9061963f726b8875ffe53da1feac8df00b040/contract';
import startContract from '../../snapshots/705398c87a4f2c7e2ac0a49002b9061963f726b8875ffe53da1feac8df00b040/contract.json' with {
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
