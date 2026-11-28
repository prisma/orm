#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/3cff71cc66e968c8f6cfa1a30c2de60d20b1b089a115c81eeca3ee0352a43316/contract';
import endContract from '../snapshots/3cff71cc66e968c8f6cfa1a30c2de60d20b1b089a115c81eeca3ee0352a43316/contract.json' with {
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
