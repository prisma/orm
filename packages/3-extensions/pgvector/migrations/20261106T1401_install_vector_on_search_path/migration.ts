#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/e4ab7d4329212a72d8e440fd7bf95a03e5c861e1d304dce1025b0fcaa1910d15/contract';
import endContract from '../snapshots/e4ab7d4329212a72d8e440fd7bf95a03e5c861e1d304dce1025b0fcaa1910d15/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.createSchema({ schema: 'public' }), this.createExtension({ extension: 'vector' })];
  }
}

MigrationCLI.run(import.meta.url, M);
