#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/8efabf1709d15395ac2ec65763fc0990d61dc07834557071280f445c6b989096/contract';
import endContract from '../../snapshots/8efabf1709d15395ac2ec65763fc0990d61dc07834557071280f445c6b989096/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/94e3c5c3854604370ede65f7bf3a667cb020c97dd70a7542bb44da0c3e21ba40/contract';
import startContract from '../../snapshots/94e3c5c3854604370ede65f7bf3a667cb020c97dd70a7542bb44da0c3e21ba40/contract.json' with {
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
