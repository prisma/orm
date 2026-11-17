#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/76f9a7585ee104f29508fd0ba31f78665ef252d0a42d9d78e1f0ad1ff4dfbe01/contract';
import startContract from '../../snapshots/76f9a7585ee104f29508fd0ba31f78665ef252d0a42d9d78e1f0ad1ff4dfbe01/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/fa509ad2ef15e0d1cd65b6b858d4729d9ac7c50ea28df3dab7cb790bc15d791d/contract';
import endContract from '../../snapshots/fa509ad2ef15e0d1cd65b6b858d4729d9ac7c50ea28df3dab7cb790bc15d791d/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('avatar', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
