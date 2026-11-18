#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/eb97f4c11af6a9444c3f8d1e1c2071f8cf7c8643b44ba9ba51752b10c639b8dc/contract';
import endContract from '../snapshots/eb97f4c11af6a9444c3f8d1e1c2071f8cf7c8643b44ba9ba51752b10c639b8dc/contract.json' with {
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
