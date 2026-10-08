#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/c8e3487092b1860d3580b7a836bbb2969a078438fc0183e4e7dc1e00d2b8ad77/contract';
import endContract from '../../snapshots/c8e3487092b1860d3580b7a836bbb2969a078438fc0183e4e7dc1e00d2b8ad77/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/cab48902634fbf554b0f38bcbf8afa55977ac0b72a4e72e35b42d4b233ed8065/contract';
import startContract from '../../snapshots/cab48902634fbf554b0f38bcbf8afa55977ac0b72a4e72e35b42d4b233ed8065/contract.json' with {
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
