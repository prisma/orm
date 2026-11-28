#!/usr/bin/env -S node
import {
  col,
  fn,
  Migration,
  MigrationCLI,
  primaryKey,
} from '@prisma/orm-postgres/target/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: '293361018b39f7c997459413d43e9b68895a39d39cffa42200f831f7e77c717a',
    };
  }

  override get operations() {
    return [
      this.createTable({
        table: 'telemetry_event',
        columns: [
          col('agent', 'text'),
          col('arch', 'text', { notNull: true }),
          col('command', 'text', { notNull: true }),
          col('databaseTarget', 'text'),
          col('extensions', 'jsonb', { notNull: true }),
          col('flags', 'jsonb', { notNull: true }),
          col('id', 'BIGSERIAL', { notNull: true }),
          col('ingestedAt', 'timestamptz', { notNull: true, default: fn('now()') }),
          col('installationId', 'text', { notNull: true }),
          col('os', 'text', { notNull: true }),
          col('packageManager', 'text'),
          col('runtimeName', 'text', { notNull: true }),
          col('runtimeVersion', 'text', { notNull: true }),
          col('tsVersion', 'text'),
          col('version', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        table: 'telemetry_event',
        index: 'telemetry_event_ingestedAt_idx',
        columns: ['ingestedAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
