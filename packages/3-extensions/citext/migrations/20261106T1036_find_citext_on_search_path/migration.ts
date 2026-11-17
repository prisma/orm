#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as Start } from '../snapshots/62dbb8d4183a5d944c332f5122eb9cea170bb06fa21f7c01fc9093cd074ffbfa/contract';
import startContract from '../snapshots/62dbb8d4183a5d944c332f5122eb9cea170bb06fa21f7c01fc9093cd074ffbfa/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../snapshots/d4b1506484b9bdc7faf420bf5d126e61a22f193c94cdb9bb0f41eff0402e9d25/contract';
import endContract from '../snapshots/d4b1506484b9bdc7faf420bf5d126e61a22f193c94cdb9bb0f41eff0402e9d25/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
