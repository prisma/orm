#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: '293361018b39f7c997459413d43e9b68895a39d39cffa42200f831f7e77c717a',
      to: '63d3e6e892a4f2d8a1cbd6887aad9111841663597f16f92a1bd5e4f6069785c1',
    };
  }

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
