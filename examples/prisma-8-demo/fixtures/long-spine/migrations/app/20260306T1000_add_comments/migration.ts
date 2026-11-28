#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/3e6f9f8cc4988cbd05ddb44046382e9baff1440c0897a3111c21e09ad35ecbe1/contract';
import endContract from '../../snapshots/3e6f9f8cc4988cbd05ddb44046382e9baff1440c0897a3111c21e09ad35ecbe1/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/74586f3ddc3b638b7a394f5a483cfe8d98d21472650e5da750ecf29b2a80e02d/contract';
import startContract from '../../snapshots/74586f3ddc3b638b7a394f5a483cfe8d98d21472650e5da750ecf29b2a80e02d/contract.json' with {
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
