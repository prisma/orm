#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import type { Contract as Start } from '../snapshots/d44df6615dfdbbc238d80062762acdd8c3947ee0da46797f0ee464db94f32cc4/contract';
import startContract from '../snapshots/d44df6615dfdbbc238d80062762acdd8c3947ee0da46797f0ee464db94f32cc4/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../snapshots/87b5ae5ff69f2ac4065b9789ede636ad4092adb1b7a14387766c9d28e8e3b0ab/contract';
import endContract from '../snapshots/87b5ae5ff69f2ac4065b9789ede636ad4092adb1b7a14387766c9d28e8e3b0ab/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.createExtension({ schema: 'public', extension: 'vector' })];
  }
}

MigrationCLI.run(import.meta.url, M);
