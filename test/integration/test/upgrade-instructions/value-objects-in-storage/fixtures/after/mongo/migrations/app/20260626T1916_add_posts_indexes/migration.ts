#!/usr/bin/env -S node
import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as Start } from '../../snapshots/95332b0bd6fbbfab4462d882c037a574c92e51897249c333ba681b12c4d603c9/contract';
import startContract from '../../snapshots/95332b0bd6fbbfab4462d882c037a574c92e51897249c333ba681b12c4d603c9/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/406b672b68a6b01f04c0d6f910f5fefa4ac16d48b26e6c91b43856cd42c8cc5d/contract';
import endContract from '../../snapshots/406b672b68a6b01f04c0d6f910f5fefa4ac16d48b26e6c91b43856cd42c8cc5d/contract.json' with {
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
