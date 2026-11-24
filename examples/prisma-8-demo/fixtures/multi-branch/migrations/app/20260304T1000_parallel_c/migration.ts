#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/94e3c5c3854604370ede65f7bf3a667cb020c97dd70a7542bb44da0c3e21ba40/contract';
import startContract from '../../snapshots/94e3c5c3854604370ede65f7bf3a667cb020c97dd70a7542bb44da0c3e21ba40/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/a985c71142f225b39f8d6a238c9ef3efa1ef25cbe6d24698b0ec9f4386314da0/contract';
import endContract from '../../snapshots/a985c71142f225b39f8d6a238c9ef3efa1ef25cbe6d24698b0ec9f4386314da0/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('feature', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
