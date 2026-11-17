#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/postgres/migration';
import type { Contract as End } from '../../snapshots/eac9a16cf3aae00acba34eeb8f738ba0dab4bc5cf1ed4bc76822727c30fb937f/contract';
import endContract from '../../snapshots/eac9a16cf3aae00acba34eeb8f738ba0dab4bc5cf1ed4bc76822727c30fb937f/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
