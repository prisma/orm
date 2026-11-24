#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/94e3c5c3854604370ede65f7bf3a667cb020c97dd70a7542bb44da0c3e21ba40/contract';
import endContract from '../../snapshots/94e3c5c3854604370ede65f7bf3a667cb020c97dd70a7542bb44da0c3e21ba40/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/345059ad82748235deff6cf12d40690f582d2420e63dccaf41c1c3fe654777b4/contract';
import startContract from '../../snapshots/345059ad82748235deff6cf12d40690f582d2420e63dccaf41c1c3fe654777b4/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('bio', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
