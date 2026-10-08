#!/usr/bin/env -S node
import { col, fn, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/71947ab1c58924051819079568facc696eca0ce0bb455e512ec35e59a7fa5037/contract';
import startContract from '../../snapshots/71947ab1c58924051819079568facc696eca0ce0bb455e512ec35e59a7fa5037/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/cab48902634fbf554b0f38bcbf8afa55977ac0b72a4e72e35b42d4b233ed8065/contract';
import endContract from '../../snapshots/cab48902634fbf554b0f38bcbf8afa55977ac0b72a4e72e35b42d4b233ed8065/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'post',
        column: col('expiresAt', 'timestamptz', {
          notNull: true,
          default: fn("(now() + '7 days'::interval)"),
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
