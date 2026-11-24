#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/06685743c4efade6ebe23107ee1446856d8162256db929bc6cf1b489ac50cd9f/contract';
import startContract from '../../snapshots/06685743c4efade6ebe23107ee1446856d8162256db929bc6cf1b489ac50cd9f/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/dd82e11b5f4dfa09cd67940157512651f7e27173457e7327664148b4d7edc273/contract';
import endContract from '../../snapshots/dd82e11b5f4dfa09cd67940157512651f7e27173457e7327664148b4d7edc273/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('comments', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
