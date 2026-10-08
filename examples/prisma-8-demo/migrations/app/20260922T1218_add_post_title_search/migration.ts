#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/5123f3b3c8f1b62719f0465be6012ec980fe9debf23acd8eecf890ca170c23fb/contract';
import startContract from '../../snapshots/5123f3b3c8f1b62719f0465be6012ec980fe9debf23acd8eecf890ca170c23fb/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/cd8e04ee8f169c956418763efc967187df5b7f52840930da247c923037bfd81b/contract';
import endContract from '../../snapshots/cd8e04ee8f169c956418763efc967187df5b7f52840930da247c923037bfd81b/contract.json' with {
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
