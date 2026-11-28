#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/ec64333c2e78e8c3e358e60becb8e16aad5b2851496e4e9065fe5a4b3ca6003b/contract';
import endContract from '../snapshots/ec64333c2e78e8c3e358e60becb8e16aad5b2851496e4e9065fe5a4b3ca6003b/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createExtension({ extension: 'pg_search' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
