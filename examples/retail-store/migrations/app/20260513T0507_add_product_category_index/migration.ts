#!/usr/bin/env -S node
import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/32b49a010a6bec06827848a71ade1588d7863e429644edc402becee50580be78/contract';
import endContract from '../../snapshots/32b49a010a6bec06827848a71ade1588d7863e429644edc402becee50580be78/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/917a8cff4030fa9140b93367a663f33d66cd14e92547b51e23a9ff82ffabf27f/contract';
import startContract from '../../snapshots/917a8cff4030fa9140b93367a663f33d66cd14e92547b51e23a9ff82ffabf27f/contract.json' with {
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
