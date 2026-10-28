#!/usr/bin/env -S node
import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as Start } from '../../snapshots/62671fbf016c515d808ac613743fddbf3db80384c1997251eac9d6f5fc063590/contract';
import startContract from '../../snapshots/62671fbf016c515d808ac613743fddbf3db80384c1997251eac9d6f5fc063590/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/d264cabd6a02546054a776ed3c04438b9a22989f406c49f5590f7f2101156eb0/contract';
import endContract from '../../snapshots/d264cabd6a02546054a776ed3c04438b9a22989f406c49f5590f7f2101156eb0/contract.json' with {
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
