#!/usr/bin/env -S node
import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/87af11776eb9e56ef9b74c7c16877e90a8a28e9013adfbdf3ff07d15e691326e/contract';
import endContract from '../../snapshots/87af11776eb9e56ef9b74c7c16877e90a8a28e9013adfbdf3ff07d15e691326e/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/eb748f8ff693da7604eef2fc642481cb4b855907df6f6ad48620d6eac7b7b7a8/contract';
import startContract from '../../snapshots/eb748f8ff693da7604eef2fc642481cb4b855907df6f6ad48620d6eac7b7b7a8/contract.json' with {
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
