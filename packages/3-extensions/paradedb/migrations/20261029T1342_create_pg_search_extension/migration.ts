#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/9a6627d7f3d6e984216f77015b8f2086254d154cc1dfe614d6ead32ec7c8b5a8/contract';
import endContract from '../snapshots/9a6627d7f3d6e984216f77015b8f2086254d154cc1dfe614d6ead32ec7c8b5a8/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createExtension({ schema: 'public', extension: 'pg_search' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
