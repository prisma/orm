#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as Start } from '../snapshots/2db551a8a5619d0d97710f29130eaea0eccbdd5238f015ee9d18408d438e0f8a/contract';
import startContract from '../snapshots/2db551a8a5619d0d97710f29130eaea0eccbdd5238f015ee9d18408d438e0f8a/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../snapshots/6e985087b60584f70ad4f223d8926dfe553db727cc4d58524fe5c38628fef393/contract';
import endContract from '../snapshots/6e985087b60584f70ad4f223d8926dfe553db727cc4d58524fe5c38628fef393/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.createExtension({ schema: 'public', extension: 'postgis' })];
  }
}

MigrationCLI.run(import.meta.url, M);
