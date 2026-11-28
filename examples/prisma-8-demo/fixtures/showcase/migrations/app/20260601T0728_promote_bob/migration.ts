#!/usr/bin/env -S node
import { col, lit, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/7ee51c0ee5ce319dce63f7ef354eec674fe7e00d5db417e39f80649e15e5e96f/contract';
import endContract from '../../snapshots/7ee51c0ee5ce319dce63f7ef354eec674fe7e00d5db417e39f80649e15e5e96f/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/838ff962efc1b2f419ee4f188ebd193b1c10f5e89e9d6e31e90517876ce8239a/contract';
import startContract from '../../snapshots/838ff962efc1b2f419ee4f188ebd193b1c10f5e89e9d6e31e90517876ce8239a/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('bio', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('locale', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('phone', 'text') }),
      this.addColumn({
        schema: '__unbound__',
        table: 'account',
        column: col('verified', 'bool', { notNull: true, default: lit(true) }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
