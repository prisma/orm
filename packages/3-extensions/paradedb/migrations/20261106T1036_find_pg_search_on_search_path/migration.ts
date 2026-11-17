#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/5abfbfd255aa419ec9eecc2b420820f4f68a07c92a9901a87240b3ab2c9ee0e8/contract';
import endContract from '../snapshots/5abfbfd255aa419ec9eecc2b420820f4f68a07c92a9901a87240b3ab2c9ee0e8/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../snapshots/9a6627d7f3d6e984216f77015b8f2086254d154cc1dfe614d6ead32ec7c8b5a8/contract';
import startContract from '../snapshots/9a6627d7f3d6e984216f77015b8f2086254d154cc1dfe614d6ead32ec7c8b5a8/contract.json' with {
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
