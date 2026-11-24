#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/345059ad82748235deff6cf12d40690f582d2420e63dccaf41c1c3fe654777b4/contract';
import startContract from '../../snapshots/345059ad82748235deff6cf12d40690f582d2420e63dccaf41c1c3fe654777b4/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/ddcbf3e5c4cba997e68b22cf1a52d92007e72e51d983b6f5707fed722a672c1b/contract';
import endContract from '../../snapshots/ddcbf3e5c4cba997e68b22cf1a52d92007e72e51d983b6f5707fed722a672c1b/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('avatar', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('posts', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
