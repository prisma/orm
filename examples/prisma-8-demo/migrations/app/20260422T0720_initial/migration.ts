#!/usr/bin/env -S node
import {
  checkExpression,
  col,
  fn,
  lit,
  Migration,
  MigrationCLI,
  primaryKey,
  rawSql,
  unique,
} from '@prisma/orm-postgres/target/migration';
import type { Contract as End } from '../../snapshots/b1643ad5e63c8896f80a44f59430cefd17a44554e3b5458121bf1bc87a89bbc0/contract';
import endContract from '../../snapshots/b1643ad5e63c8896f80a44f59430cefd17a44554e3b5458121bf1bc87a89bbc0/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      rawSql({
        id: 'extension.vector',
        label: 'Enable extension "vector"',
        summary: 'Ensures the vector extension is available for pgvector operations',
        operationClass: 'additive',
        target: { id: 'postgres' },
        precheck: [
          {
            description: 'verify extension "vector" is not already enabled',
            sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
          },
        ],
        execute: [
          {
            description: 'create extension "vector"',
            sql: 'CREATE EXTENSION IF NOT EXISTS vector',
          },
        ],
        postcheck: [
          {
            description: 'confirm extension "vector" is enabled',
            sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
          },
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'bug',
        columns: [
          col('id', 'uuid', { notNull: true }),
          col('severity', 'text', { notNull: true }),
          col('stepsToRepro', 'text'),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'feature',
        columns: [
          col('id', 'uuid', { notNull: true }),
          col('priority', 'text', { notNull: true }),
          col('targetRelease', 'text'),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'tag',
        columns: [col('id', 'uuid', { notNull: true }), col('label', 'text', { notNull: true })],
        constraints: [primaryKey(['id']), unique(['label'], { name: 'tag_label_key' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'user',
        columns: [
          col('address', 'jsonb'),
          col('createdAt', 'timestamptz', { notNull: true, default: fn('now()') }),
          col('displayName', 'text', { notNull: true }),
          col('email', 'text', { notNull: true }),
          col('id', 'uuid', { notNull: true }),
          col('kind', 'text', { notNull: true }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('user_kind_check_836d43ef', "\"kind\" IN ('admin', 'user')"),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'post',
        columns: [
          col('createdAt', 'timestamptz', { notNull: true, default: fn('now()') }),
          col('embedding', 'vector(1536)'),
          col('id', 'uuid', { notNull: true }),
          col('priority', 'text', { notNull: true, default: lit('low') }),
          col('title', 'text', { notNull: true }),
          col('userId', 'uuid', { notNull: true }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'post_priority_check_09b41aa0',
            "\"priority\" IN ('low', 'high', 'urgent')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'task',
        columns: [
          col('createdAt', 'timestamptz', { notNull: true, default: fn('now()') }),
          col('description', 'text'),
          col('id', 'uuid', { notNull: true }),
          col('status', 'text', { notNull: true, default: lit('open') }),
          col('title', 'text', { notNull: true }),
          col('type', 'text', { notNull: true }),
          col('userId', 'uuid', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'post_tag',
        columns: [
          col('postId', 'uuid', { notNull: true }),
          col('tagId', 'uuid', { notNull: true }),
        ],
        constraints: [primaryKey(['postId', 'tagId'])],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'post',
        foreignKey: {
          name: 'post_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.createIndex({
        schema: 'public',
        table: 'post',
        index: 'post_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'task',
        foreignKey: {
          name: 'task_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.createIndex({
        schema: 'public',
        table: 'task',
        index: 'task_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'bug',
        foreignKey: {
          name: 'bug_id_fkey',
          columns: ['id'],
          references: { schema: 'public', table: 'task', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'feature',
        foreignKey: {
          name: 'feature_id_fkey',
          columns: ['id'],
          references: { schema: 'public', table: 'task', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.createIndex({
        schema: 'public',
        table: 'post_tag',
        index: 'post_tag_postId_idx_a7a72715',
        columns: ['postId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'post_tag',
        index: 'post_tag_tagId_idx_86854244',
        columns: ['tagId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'post_tag',
        foreignKey: {
          name: 'post_tag_postId_fkey',
          columns: ['postId'],
          references: { schema: 'public', table: 'post', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'post_tag',
        foreignKey: {
          name: 'post_tag_tagId_fkey',
          columns: ['tagId'],
          references: { schema: 'public', table: 'tag', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
