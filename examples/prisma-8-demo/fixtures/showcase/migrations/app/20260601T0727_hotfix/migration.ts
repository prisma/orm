#!/usr/bin/env -S node
import { col, lit, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/7ee51c0ee5ce319dce63f7ef354eec674fe7e00d5db417e39f80649e15e5e96f/contract';
import endContract from '../../snapshots/7ee51c0ee5ce319dce63f7ef354eec674fe7e00d5db417e39f80649e15e5e96f/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/41a05d80e8c865fc1ae198a57a9433f989fa05c32bad91e4a329749b7555f3a7/contract';
import startContract from '../../snapshots/41a05d80e8c865fc1ae198a57a9433f989fa05c32bad91e4a329749b7555f3a7/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: '__unbound__',
        table: 'account',
        column: col('verified', 'bool', { notNull: true, default: lit(true) }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
