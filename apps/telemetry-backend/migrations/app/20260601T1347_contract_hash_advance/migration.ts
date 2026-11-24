#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: '7ed7da57db81231cd12897f13155bf2cb60a46bd14affacef219ee4dd055cac5',
      to: 'ce32e00ab6eddd2e4e716365403c97fb2f82ea3d5f23ab3079b62b4d3c97dde3',
    };
  }

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
