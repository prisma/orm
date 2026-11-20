#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/postgres/migration';
import type { Contract as End } from '../../snapshots/1cc4868e51782f6a87585b26cbfdd83c44f89b973de022f42bfdddf93bce72cb/contract';
import endContract from '../../snapshots/1cc4868e51782f6a87585b26cbfdd83c44f89b973de022f42bfdddf93bce72cb/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
