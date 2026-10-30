#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/6e985087b60584f70ad4f223d8926dfe553db727cc4d58524fe5c38628fef393/contract';
import endContract from '../snapshots/6e985087b60584f70ad4f223d8926dfe553db727cc4d58524fe5c38628fef393/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createExtension({ schema: 'public', extension: 'postgis' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
