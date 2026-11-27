#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/3e6f9f8cc4988cbd05ddb44046382e9baff1440c0897a3111c21e09ad35ecbe1/contract';
import startContract from '../../snapshots/3e6f9f8cc4988cbd05ddb44046382e9baff1440c0897a3111c21e09ad35ecbe1/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/098bf8d1006ad2f6cc9484fc3383ba913f27e643d690f2d24b99a51030f13415/contract';
import endContract from '../../snapshots/098bf8d1006ad2f6cc9484fc3383ba913f27e643d690f2d24b99a51030f13415/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('tags', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
