#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/d4b1506484b9bdc7faf420bf5d126e61a22f193c94cdb9bb0f41eff0402e9d25/contract';
import endContract from '../snapshots/d4b1506484b9bdc7faf420bf5d126e61a22f193c94cdb9bb0f41eff0402e9d25/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.createSchema({ schema: 'public' }), this.createExtension({ extension: 'citext' })];
  }
}

MigrationCLI.run(import.meta.url, M);
