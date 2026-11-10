#!/usr/bin/env -S node
import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/315ba05dd789203ec66ae19c9e637054e1b70d1c1151341f551040cb908c82e4/contract';
import endContract from '../../snapshots/315ba05dd789203ec66ae19c9e637054e1b70d1c1151341f551040cb908c82e4/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/fb3df4c4899adcd423e9b75164870cef1be789fe6871a24b7fda64e707f324ad/contract';
import startContract from '../../snapshots/fb3df4c4899adcd423e9b75164870cef1be789fe6871a24b7fda64e707f324ad/contract.json' with {
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
