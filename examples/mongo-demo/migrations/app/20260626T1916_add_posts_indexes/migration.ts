#!/usr/bin/env -S node
import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as Start } from '../../snapshots/83c3ac55af222cd8f72f09900af188796ee2abb18b76235affdda67678c387a8/contract';
import startContract from '../../snapshots/83c3ac55af222cd8f72f09900af188796ee2abb18b76235affdda67678c387a8/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/ff02f1a41650a33b8fb6ecd135e3469dc868d189918615470bcbc4939dcca1c3/contract';
import endContract from '../../snapshots/ff02f1a41650a33b8fb6ecd135e3469dc868d189918615470bcbc4939dcca1c3/contract.json' with {
  type: 'json',
};

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      createIndex('posts', [{ direction: 1, field: 'authorId' }], {}),
      createIndex(
        'posts',
        [
          { direction: -1, field: 'createdAt' },
          { direction: 1, field: 'authorId' },
        ],
        {},
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
