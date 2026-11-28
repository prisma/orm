#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/bb22c199e73810537004c0d40913c37746e913633f99ff5d3ceba4a064995a95/contract';
import endContract from '../snapshots/bb22c199e73810537004c0d40913c37746e913633f99ff5d3ceba4a064995a95/contract.json' with {
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
