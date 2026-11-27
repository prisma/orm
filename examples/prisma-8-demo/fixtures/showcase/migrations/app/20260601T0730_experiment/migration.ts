#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/97725e1cc3f7525a506b2c843cad0de74838e2990dd9e16bba75b39583bc4b7d/contract';
import startContract from '../../snapshots/97725e1cc3f7525a506b2c843cad0de74838e2990dd9e16bba75b39583bc4b7d/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/d85ea3685b81847f7b3b1b3c6649067671b8212fb176a61d7d26b10b0522b2ab/contract';
import endContract from '../../snapshots/d85ea3685b81847f7b3b1b3c6649067671b8212fb176a61d7d26b10b0522b2ab/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'widget', column: col('count', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
