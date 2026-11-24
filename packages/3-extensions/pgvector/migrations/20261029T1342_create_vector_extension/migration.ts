#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as End } from '../snapshots/87b5ae5ff69f2ac4065b9789ede636ad4092adb1b7a14387766c9d28e8e3b0ab/contract';
import endContract from '../snapshots/87b5ae5ff69f2ac4065b9789ede636ad4092adb1b7a14387766c9d28e8e3b0ab/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createExtension({ schema: 'public', extension: 'vector' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
