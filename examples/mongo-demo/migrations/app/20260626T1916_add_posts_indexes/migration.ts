#!/usr/bin/env -S node
import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/61c3f027c298b11d22e875ed76ab6460d2b4396afa94bdf58d85e26aded3416c/contract';
import endContract from '../../snapshots/61c3f027c298b11d22e875ed76ab6460d2b4396afa94bdf58d85e26aded3416c/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/b6f6bd5351ad4383f8a46c585bf7f7f65483aaf898f124a130dadc46a9b373a4/contract';
import startContract from '../../snapshots/b6f6bd5351ad4383f8a46c585bf7f7f65483aaf898f124a130dadc46a9b373a4/contract.json' with {
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
