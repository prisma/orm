#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/1fb95fa184d8fbead2f8147baf16641eaeabc51459616611882ee00d85addea3/contract';
import startContract from '../../snapshots/1fb95fa184d8fbead2f8147baf16641eaeabc51459616611882ee00d85addea3/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/23371687751c218d354034a564d7709da7ac6af8dd54b37f1a2b9af4e5140073/contract';
import endContract from '../../snapshots/23371687751c218d354034a564d7709da7ac6af8dd54b37f1a2b9af4e5140073/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'avatar' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'bio' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'locale' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'phone' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'verified' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
