#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as Start } from '../snapshots/3cff71cc66e968c8f6cfa1a30c2de60d20b1b089a115c81eeca3ee0352a43316/contract';
import startContract from '../snapshots/3cff71cc66e968c8f6cfa1a30c2de60d20b1b089a115c81eeca3ee0352a43316/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../snapshots/ec64333c2e78e8c3e358e60becb8e16aad5b2851496e4e9065fe5a4b3ca6003b/contract';
import endContract from '../snapshots/ec64333c2e78e8c3e358e60becb8e16aad5b2851496e4e9065fe5a4b3ca6003b/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
