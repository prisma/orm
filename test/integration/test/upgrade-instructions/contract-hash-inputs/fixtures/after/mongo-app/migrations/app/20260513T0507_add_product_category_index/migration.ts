#!/usr/bin/env -S node
import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/c6df2c40eb8c1601ac42d20d3f20886938318d454242e855b32bc44a8d7defe2/contract';
import endContract from '../../snapshots/c6df2c40eb8c1601ac42d20d3f20886938318d454242e855b32bc44a8d7defe2/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/0fac3645b4fd64ff1ff5f4f095b61b1e4a75b909f8d1471ac3497c88b889fe09/contract';
import startContract from '../../snapshots/0fac3645b4fd64ff1ff5f4f095b61b1e4a75b909f8d1471ac3497c88b889fe09/contract.json' with {
  type: 'json',
};

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      createIndex(
        'products',
        [
          { direction: 1, field: 'primaryCategory' },
          { direction: 1, field: 'articleType' },
        ],
        {},
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
