#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/3cff71cc66e968c8f6cfa1a30c2de60d20b1b089a115c81eeca3ee0352a43316/contract';
import endContract from '../snapshots/3cff71cc66e968c8f6cfa1a30c2de60d20b1b089a115c81eeca3ee0352a43316/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../snapshots/e81e803de91cbef4b610501081e694374c04b40fb43c360d62c72e81279e7f4a/contract';
import startContract from '../snapshots/e81e803de91cbef4b610501081e694374c04b40fb43c360d62c72e81279e7f4a/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.createExtension({ schema: 'public', extension: 'pg_search' })];
  }
}

MigrationCLI.run(import.meta.url, M);
