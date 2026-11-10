#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/postgres/migration';
import type { Contract as End } from '../../snapshots/43d3880fa8b128e29f8a96c203566329c0ed35a2884901cbad49e2633b812f54/contract';
import endContract from '../../snapshots/43d3880fa8b128e29f8a96c203566329c0ed35a2884901cbad49e2633b812f54/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/d52545171b2ee43107e1a619867dde006d83c7ab8d23bc2f4797524c76c3a662/contract';
import startContract from '../../snapshots/d52545171b2ee43107e1a619867dde006d83c7ab8d23bc2f4797524c76c3a662/contract.json' with {
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
