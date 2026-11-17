#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/f894c02864e197d491f40111ceb9ec48d78de76f4462835c22a3c1f9d68f881f/contract';
import startContract from '../../snapshots/f894c02864e197d491f40111ceb9ec48d78de76f4462835c22a3c1f9d68f881f/contract.json' with {
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
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('phone', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
