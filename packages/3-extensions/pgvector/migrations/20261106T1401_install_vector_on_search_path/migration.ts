#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/d2c19e6a88b5b89e23e8ce4863844d40813bcf7712509e631d7cd29d405af27b/contract';
import endContract from '../snapshots/d2c19e6a88b5b89e23e8ce4863844d40813bcf7712509e631d7cd29d405af27b/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.createSchema({ schema: 'public' }), this.createExtension({ extension: 'vector' })];
  }
}

MigrationCLI.run(import.meta.url, M);
