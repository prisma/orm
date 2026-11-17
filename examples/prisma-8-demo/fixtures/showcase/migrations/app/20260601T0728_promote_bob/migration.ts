#!/usr/bin/env -S node
import { col, lit, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/1fb95fa184d8fbead2f8147baf16641eaeabc51459616611882ee00d85addea3/contract';
import endContract from '../../snapshots/1fb95fa184d8fbead2f8147baf16641eaeabc51459616611882ee00d85addea3/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/f894c02864e197d491f40111ceb9ec48d78de76f4462835c22a3c1f9d68f881f/contract';
import startContract from '../../snapshots/f894c02864e197d491f40111ceb9ec48d78de76f4462835c22a3c1f9d68f881f/contract.json' with {
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
