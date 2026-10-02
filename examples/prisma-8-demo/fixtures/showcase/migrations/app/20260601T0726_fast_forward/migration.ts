#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/d82c665884d8cf0745edfcc24be8b374ccbe89dffb5e3e6ab10357cad4d5f03f/contract';
import startContract from '../../snapshots/d82c665884d8cf0745edfcc24be8b374ccbe89dffb5e3e6ab10357cad4d5f03f/contract.json' with {
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
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('name', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('phone', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
