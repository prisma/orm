#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/1e19d995b1603c4082364b9a3bd4b5b140d59f4dc0aa94251ca721d6f9f8db2f/contract';
import startContract from '../../snapshots/1e19d995b1603c4082364b9a3bd4b5b140d59f4dc0aa94251ca721d6f9f8db2f/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/ff745362b097d2c6a45dac30c7679674557f0d02bf9e8de489f29fa83c773deb/contract';
import endContract from '../../snapshots/ff745362b097d2c6a45dac30c7679674557f0d02bf9e8de489f29fa83c773deb/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'bio' }),
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'posts' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
