#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/5abfbfd255aa419ec9eecc2b420820f4f68a07c92a9901a87240b3ab2c9ee0e8/contract';
import endContract from '../snapshots/5abfbfd255aa419ec9eecc2b420820f4f68a07c92a9901a87240b3ab2c9ee0e8/contract.json' with {
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
