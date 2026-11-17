#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/postgres/migration';
import type { Contract as End } from '../../snapshots/0afd7bad7a1e491be0530915cb0a910ce38a75e6195e0cf37fd752329d2bb9ab/contract';
import endContract from '../../snapshots/0afd7bad7a1e491be0530915cb0a910ce38a75e6195e0cf37fd752329d2bb9ab/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/1cc4868e51782f6a87585b26cbfdd83c44f89b973de022f42bfdddf93bce72cb/contract';
import startContract from '../../snapshots/1cc4868e51782f6a87585b26cbfdd83c44f89b973de022f42bfdddf93bce72cb/contract.json' with {
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
