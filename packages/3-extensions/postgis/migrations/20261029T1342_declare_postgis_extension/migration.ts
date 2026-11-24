#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/33d6969785263a3245e242a9b3557772ed8c33c43784af101875c3f0fd1dc8e2/contract';
import endContract from '../snapshots/33d6969785263a3245e242a9b3557772ed8c33c43784af101875c3f0fd1dc8e2/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../snapshots/66cf8884651bf90a2fea6c309af55c35481bbc46abbe9e94c8439f24e31cdce7/contract';
import startContract from '../snapshots/66cf8884651bf90a2fea6c309af55c35481bbc46abbe9e94c8439f24e31cdce7/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.createExtension({ schema: 'public', extension: 'postgis' })];
  }
}

MigrationCLI.run(import.meta.url, M);
