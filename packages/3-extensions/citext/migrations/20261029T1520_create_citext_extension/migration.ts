#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/62dbb8d4183a5d944c332f5122eb9cea170bb06fa21f7c01fc9093cd074ffbfa/contract';
import endContract from '../snapshots/62dbb8d4183a5d944c332f5122eb9cea170bb06fa21f7c01fc9093cd074ffbfa/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createExtension({ schema: 'public', extension: 'citext' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
