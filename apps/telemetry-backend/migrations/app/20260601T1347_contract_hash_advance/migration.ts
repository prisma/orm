#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: '2c0677a6b6e5b60bb328a78d882483d8a00804e00c1e05fba259ff8304882558',
      to: '269d0430c7c70fa502e75feb52d9219c0339daa041c6cc9fb4ecb5ad8d0373b6',
    };
  }

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
