#!/usr/bin/env -S node
import { col, lit, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/61e30902100ed7e888c50e4f71730672e5dbef719a662ed3b73d32e00fb52da9/contract';
import startContract from '../../snapshots/61e30902100ed7e888c50e4f71730672e5dbef719a662ed3b73d32e00fb52da9/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/b5fa4568c24ca857e46f994ffacea5566404312b58aef1ce3cd1496108665ead/contract';
import endContract from '../../snapshots/b5fa4568c24ca857e46f994ffacea5566404312b58aef1ce3cd1496108665ead/contract.json' with {
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
