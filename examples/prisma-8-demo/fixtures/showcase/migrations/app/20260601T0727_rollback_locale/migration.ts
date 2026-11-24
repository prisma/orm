#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/0fe12ba19e45836b1aacf85cdcc3a052f072d8e9000e16fb2ff1f3063d422ae4/contract';
import startContract from '../../snapshots/0fe12ba19e45836b1aacf85cdcc3a052f072d8e9000e16fb2ff1f3063d422ae4/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/4d880db0165c6d1d5ca2d5e46cd3ed57ad6cac79b1851ba64c2777fd2d289200/contract';
import endContract from '../../snapshots/4d880db0165c6d1d5ca2d5e46cd3ed57ad6cac79b1851ba64c2777fd2d289200/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropColumn({ schema: '__unbound__', table: 'account', column: 'locale' })];
  }
}

MigrationCLI.run(import.meta.url, M);
