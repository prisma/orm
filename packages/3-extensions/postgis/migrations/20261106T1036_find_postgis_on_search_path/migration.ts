#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as Start } from '../snapshots/6e985087b60584f70ad4f223d8926dfe553db727cc4d58524fe5c38628fef393/contract';
import startContract from '../snapshots/6e985087b60584f70ad4f223d8926dfe553db727cc4d58524fe5c38628fef393/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../snapshots/eb97f4c11af6a9444c3f8d1e1c2071f8cf7c8643b44ba9ba51752b10c639b8dc/contract';
import endContract from '../snapshots/eb97f4c11af6a9444c3f8d1e1c2071f8cf7c8643b44ba9ba51752b10c639b8dc/contract.json' with {
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
