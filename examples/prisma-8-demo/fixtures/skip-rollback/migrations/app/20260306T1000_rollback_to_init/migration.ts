#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/61b0977c9b9d853a6a9c92516a66c11b4b60824f0a39386c733206093cbb09c3/contract';
import endContract from '../../snapshots/61b0977c9b9d853a6a9c92516a66c11b4b60824f0a39386c733206093cbb09c3/contract.json' with {
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
    return [
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'bio' }),
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'phone' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
