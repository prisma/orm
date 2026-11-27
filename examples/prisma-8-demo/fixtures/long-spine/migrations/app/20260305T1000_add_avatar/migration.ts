#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/1e19d995b1603c4082364b9a3bd4b5b140d59f4dc0aa94251ca721d6f9f8db2f/contract';
import startContract from '../../snapshots/1e19d995b1603c4082364b9a3bd4b5b140d59f4dc0aa94251ca721d6f9f8db2f/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/74586f3ddc3b638b7a394f5a483cfe8d98d21472650e5da750ecf29b2a80e02d/contract';
import endContract from '../../snapshots/74586f3ddc3b638b7a394f5a483cfe8d98d21472650e5da750ecf29b2a80e02d/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('avatar', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
