#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/postgres/migration';
import type { Contract as End } from '../../snapshots/b125bc8a23cb005d4a843e746b19417156e64c9104e9199ce1a059dac6f70fbb/contract';
import endContract from '../../snapshots/b125bc8a23cb005d4a843e746b19417156e64c9104e9199ce1a059dac6f70fbb/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/eac9a16cf3aae00acba34eeb8f738ba0dab4bc5cf1ed4bc76822727c30fb937f/contract';
import startContract from '../../snapshots/eac9a16cf3aae00acba34eeb8f738ba0dab4bc5cf1ed4bc76822727c30fb937f/contract.json' with {
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
