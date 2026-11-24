#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/525867e53b3d9a4667d113111afb4674fec9e9fd6fd2283321bb3593fbaf0b0f/contract';
import endContract from '../../snapshots/525867e53b3d9a4667d113111afb4674fec9e9fd6fd2283321bb3593fbaf0b0f/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/dd82e11b5f4dfa09cd67940157512651f7e27173457e7327664148b4d7edc273/contract';
import startContract from '../../snapshots/dd82e11b5f4dfa09cd67940157512651f7e27173457e7327664148b4d7edc273/contract.json' with {
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
