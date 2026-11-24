#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/655a02a0d6f5c49934f6bc8e7c72897dc798c90b8d8f5295d3bacec3ed86feb0/contract';
import endContract from '../../snapshots/655a02a0d6f5c49934f6bc8e7c72897dc798c90b8d8f5295d3bacec3ed86feb0/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/8efabf1709d15395ac2ec65763fc0990d61dc07834557071280f445c6b989096/contract';
import startContract from '../../snapshots/8efabf1709d15395ac2ec65763fc0990d61dc07834557071280f445c6b989096/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('posts', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
