#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/6c01c7bf566e073fc66946ed1890f9825cbd37707435b19f0aab4b6e46c2604e/contract';
import startContract from '../../snapshots/6c01c7bf566e073fc66946ed1890f9825cbd37707435b19f0aab4b6e46c2604e/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/394928efe50bc178141cde5e5fc5b99188968f02ced07b4832a12eef0bf1007f/contract';
import endContract from '../../snapshots/394928efe50bc178141cde5e5fc5b99188968f02ced07b4832a12eef0bf1007f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('avatar', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('name', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('phone', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
