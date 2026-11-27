#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/1e19d995b1603c4082364b9a3bd4b5b140d59f4dc0aa94251ca721d6f9f8db2f/contract';
import endContract from '../../snapshots/1e19d995b1603c4082364b9a3bd4b5b140d59f4dc0aa94251ca721d6f9f8db2f/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/b14ebedaafc98e737ca69b4b61f4dc44b7ba85c117b412b933d78bb6dd557971/contract';
import startContract from '../../snapshots/b14ebedaafc98e737ca69b4b61f4dc44b7ba85c117b412b933d78bb6dd557971/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('posts', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
