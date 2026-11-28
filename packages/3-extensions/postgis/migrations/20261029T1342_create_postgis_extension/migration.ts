#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/33d6969785263a3245e242a9b3557772ed8c33c43784af101875c3f0fd1dc8e2/contract';
import endContract from '../snapshots/33d6969785263a3245e242a9b3557772ed8c33c43784af101875c3f0fd1dc8e2/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createExtension({ schema: 'public', extension: 'postgis' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
