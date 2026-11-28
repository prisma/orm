#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/708c4cab1879cdc2e8ce64956107bb9ea241e51cdc7393946fc809bfde788ff7/contract';
import endContract from '../snapshots/708c4cab1879cdc2e8ce64956107bb9ea241e51cdc7393946fc809bfde788ff7/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.createSchema({ schema: 'public' }), this.createExtension({ extension: 'citext' })];
  }
}

MigrationCLI.run(import.meta.url, M);
