#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as Start } from '../snapshots/0c0734babd6eeb868fee1f281ca96963022475611560e9f170f465daa35f8599/contract';
import startContract from '../snapshots/0c0734babd6eeb868fee1f281ca96963022475611560e9f170f465daa35f8599/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../snapshots/9a6627d7f3d6e984216f77015b8f2086254d154cc1dfe614d6ead32ec7c8b5a8/contract';
import endContract from '../snapshots/9a6627d7f3d6e984216f77015b8f2086254d154cc1dfe614d6ead32ec7c8b5a8/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.createExtension({ schema: 'public', extension: 'pg_search' })];
  }
}

MigrationCLI.run(import.meta.url, M);
