#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/postgres/migration';
import type { Contract as End } from '../../snapshots/d52545171b2ee43107e1a619867dde006d83c7ab8d23bc2f4797524c76c3a662/contract';
import endContract from '../../snapshots/d52545171b2ee43107e1a619867dde006d83c7ab8d23bc2f4797524c76c3a662/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
