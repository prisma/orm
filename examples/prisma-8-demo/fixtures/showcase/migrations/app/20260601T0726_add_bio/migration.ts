#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/0d01a7e1c00acc052445624ecfc1542bbee85bdbd8d531c69b826b0a6698e14e/contract';
import endContract from '../../snapshots/0d01a7e1c00acc052445624ecfc1542bbee85bdbd8d531c69b826b0a6698e14e/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/fa509ad2ef15e0d1cd65b6b858d4729d9ac7c50ea28df3dab7cb790bc15d791d/contract';
import startContract from '../../snapshots/fa509ad2ef15e0d1cd65b6b858d4729d9ac7c50ea28df3dab7cb790bc15d791d/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('bio', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
