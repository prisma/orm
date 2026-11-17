#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as Start } from '../snapshots/698fc52f21eb891517203ef4b229823d17c49c3f802e2374be292a9b6a560c97/contract';
import startContract from '../snapshots/698fc52f21eb891517203ef4b229823d17c49c3f802e2374be292a9b6a560c97/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../snapshots/e4ab7d4329212a72d8e440fd7bf95a03e5c861e1d304dce1025b0fcaa1910d15/contract';
import endContract from '../snapshots/e4ab7d4329212a72d8e440fd7bf95a03e5c861e1d304dce1025b0fcaa1910d15/contract.json' with {
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
