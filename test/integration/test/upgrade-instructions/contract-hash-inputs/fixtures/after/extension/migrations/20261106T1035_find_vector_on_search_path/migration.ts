#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as Start } from '../snapshots/87b5ae5ff69f2ac4065b9789ede636ad4092adb1b7a14387766c9d28e8e3b0ab/contract';
import startContract from '../snapshots/87b5ae5ff69f2ac4065b9789ede636ad4092adb1b7a14387766c9d28e8e3b0ab/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../snapshots/d2c19e6a88b5b89e23e8ce4863844d40813bcf7712509e631d7cd29d405af27b/contract';
import endContract from '../snapshots/d2c19e6a88b5b89e23e8ce4863844d40813bcf7712509e631d7cd29d405af27b/contract.json' with {
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
