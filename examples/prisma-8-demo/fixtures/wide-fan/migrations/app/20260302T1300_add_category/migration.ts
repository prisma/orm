#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as End } from '../../snapshots/2f1ff019ac9156a2428afe579397f55f6dc062508364ebf38fbce1e25c70a342/contract';
import endContract from '../../snapshots/2f1ff019ac9156a2428afe579397f55f6dc062508364ebf38fbce1e25c70a342/contract.json' with {
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
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('category', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
