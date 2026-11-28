#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/1cb4699baa36101c9bb69a110c407a0e2c4bca0359d6003808f1bb2ac30a6c28/contract';
import endContract from '../snapshots/1cb4699baa36101c9bb69a110c407a0e2c4bca0359d6003808f1bb2ac30a6c28/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createExtension({ extension: 'postgis' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
