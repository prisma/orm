#!/usr/bin/env -S node
import { col, Migration, MigrationCLI, primaryKey } from '@prisma/orm-postgres/target/migration';
import type { Contract as End } from '../../snapshots/28b5e5f98ce0e148f03e345518c9c53cb7a04a82e8e58de74a87c1b4ae08cf65/contract';
import endContract from '../../snapshots/28b5e5f98ce0e148f03e345518c9c53cb7a04a82e8e58de74a87c1b4ae08cf65/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'cafe',
        columns: [
          col('id', 'character(36)', { notNull: true }),
          col('location', 'geometry(Geometry,4326)', { notNull: true }),
          col('name', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'neighborhood',
        columns: [
          col('boundary', 'geometry(Geometry,4326)', { notNull: true }),
          col('id', 'character(36)', { notNull: true }),
          col('name', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'route',
        columns: [
          col('id', 'character(36)', { notNull: true }),
          col('name', 'text', { notNull: true }),
          col('path', 'geometry(Geometry,4326)', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
