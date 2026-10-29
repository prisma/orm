#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/698fc52f21eb891517203ef4b229823d17c49c3f802e2374be292a9b6a560c97/contract';
import endContract from '../snapshots/698fc52f21eb891517203ef4b229823d17c49c3f802e2374be292a9b6a560c97/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createExtension({ schema: 'public', extension: 'vector' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
