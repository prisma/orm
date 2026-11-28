#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/708c4cab1879cdc2e8ce64956107bb9ea241e51cdc7393946fc809bfde788ff7/contract';
import endContract from '../snapshots/708c4cab1879cdc2e8ce64956107bb9ea241e51cdc7393946fc809bfde788ff7/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../snapshots/bb22c199e73810537004c0d40913c37746e913633f99ff5d3ceba4a064995a95/contract';
import startContract from '../snapshots/bb22c199e73810537004c0d40913c37746e913633f99ff5d3ceba4a064995a95/contract.json' with {
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
