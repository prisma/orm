#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/ddcbf3e5c4cba997e68b22cf1a52d92007e72e51d983b6f5707fed722a672c1b/contract';
import endContract from '../../snapshots/ddcbf3e5c4cba997e68b22cf1a52d92007e72e51d983b6f5707fed722a672c1b/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/eebc10206a16b7203efeaebe0db58d07267db0d76babaf21a3d8feef9357cf09/contract';
import startContract from '../../snapshots/eebc10206a16b7203efeaebe0db58d07267db0d76babaf21a3d8feef9357cf09/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('phone', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('posts', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
