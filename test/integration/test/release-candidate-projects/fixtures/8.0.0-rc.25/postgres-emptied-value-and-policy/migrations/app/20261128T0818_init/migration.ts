#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/d8fce09210865e63cf85ffe3a963487a7e1c4d87ee73f4c6f51a5bce1f0a55be/contract';
import endContract from '../../snapshots/d8fce09210865e63cf85ffe3a963487a7e1c4d87ee73f4c6f51a5bce1f0a55be/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'Post',
        columns: [
          col('authorId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('meta', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'User',
        columns: [
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'User',
        constraint: 'User_email_key',
        columns: ['email'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Post',
        index: 'Post_authorId_idx_e47547ed',
        columns: ['authorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Post',
        index: 'post_meta_gin_3aa57499',
        columns: ['meta'],
        extras: { type: 'gin', options: {} },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Post',
        foreignKey: {
          name: 'Post_authorId_fkey',
          columns: ['authorId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'Post' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'Post',
        policy: {
          naming: { kind: 'wire', prefix: 'post_no_roles', hash: 'dbc82c49' },
          tableName: 'Post',
          namespaceId: 'public',
          operation: 'select',
          roles: [],
          using: sql`true`,
          permissive: true,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
