import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import {
  buildControlTableBootstrapQueries,
  createTable,
} from '@internal/target-mysql/contract-free';
import { describe, expect, it } from 'vitest';
import { mysqlInlineLiteral } from '../src/core/migrations/ddl-renderer';
import { createAdapter } from './helpers';

const where = { table: 't', column: 'c' };

describe('MySQL DDL', () => {
  it('creates the marker and ledger tables', async () => {
    const adapter = createAdapter();
    const statements = await Promise.all(
      buildControlTableBootstrapQueries().map(
        async (node) => (await adapter.lowerToExecuteRequest(node)).sql,
      ),
    );
    expect(statements).toEqual([
      [
        'CREATE TABLE IF NOT EXISTS `_prisma_marker` (',
        "  `space` varchar(191) NOT NULL DEFAULT 'app' PRIMARY KEY,",
        '  `core_hash` varchar(191) NOT NULL,',
        '  `profile_hash` varchar(191) NOT NULL,',
        '  `contract_json` longtext,',
        '  `canonical_version` int,',
        '  `updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),',
        '  `app_tag` text,',
        "  `meta` text NOT NULL DEFAULT ('{}'),",
        "  `invariants` text NOT NULL DEFAULT ('[]')",
        ')',
      ].join('\n'),
      [
        'CREATE TABLE IF NOT EXISTS `_prisma_ledger` (',
        '  `id` bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,',
        '  `created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),',
        '  `space` varchar(191) NOT NULL,',
        '  `migration_name` text NOT NULL,',
        '  `migration_hash` varchar(191) NOT NULL,',
        '  `origin_core_hash` varchar(191),',
        '  `origin_profile_hash` varchar(191),',
        '  `destination_core_hash` varchar(191) NOT NULL,',
        '  `destination_profile_hash` varchar(191),',
        '  `contract_json_before` longtext,',
        '  `contract_json_after` longtext,',
        '  `operations` longtext NOT NULL',
        ')',
      ].join('\n'),
    ]);
  });

  it('writes table constraints with backticks', async () => {
    const node = createTable({
      table: 'Post',
      columns: [col('id', 'int', { notNull: true }), col('authorId', 'int', { notNull: true })],
      constraints: [
        { kind: 'primary-key', columns: ['id'], name: undefined },
        { kind: 'unique', columns: ['authorId'], name: 'Post_authorId_key' },
        {
          kind: 'foreign-key',
          columns: ['authorId'],
          refTable: 'User',
          refColumns: ['id'],
          name: 'Post_authorId_fkey',
          onDelete: 'cascade',
          onUpdate: 'restrict',
        },
      ] as never,
    });
    expect((await createAdapter().lowerToExecuteRequest(node)).sql).toBe(
      [
        'CREATE TABLE `Post` (',
        '  `id` int NOT NULL,',
        '  `authorId` int NOT NULL,',
        '  PRIMARY KEY (`id`),',
        '  CONSTRAINT `Post_authorId_key` UNIQUE (`authorId`),',
        '  CONSTRAINT `Post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT',
        ')',
      ].join('\n'),
    );
  });

  it('refuses a CHECK constraint', async () => {
    const node = createTable({
      table: 't',
      columns: [col('id', 'int')],
      constraints: [{ kind: 'check-expression', name: 'positive', expression: 'id > 0' }] as never,
    });
    await expect(createAdapter().lowerToExecuteRequest(node)).rejects.toThrow(/CHECK constraints/);
  });
});

describe('column defaults', () => {
  const adapter = createAdapter();
  const render = (type: string, def: Parameters<typeof col>[2]) =>
    adapter.renderColumnDefault(col('c', type, def), 't');

  it.each([
    ['int', { default: lit(7) }, 'DEFAULT 7'],
    ['varchar(10)', { default: lit("it's") }, "DEFAULT 'it''s'"],
    ['text', { default: lit('x') }, "DEFAULT ('x')"],
    ['json', { default: lit('{}') }, "DEFAULT ('{}')"],
    ['int', { default: lit(null) }, 'DEFAULT NULL'],
    ['datetime(6)', { default: fn('now()') }, 'DEFAULT (CURRENT_TIMESTAMP(6))'],
    ['datetime', { default: fn('now()') }, 'DEFAULT (CURRENT_TIMESTAMP)'],
    ['int', { default: fn('autoincrement()') }, ''],
    ['int', {}, ''],
  ])('writes the default of a %s column with %j as %j', async (type, def, clause) => {
    expect(await render(type, def)).toBe(clause);
  });

  it.each([
    ['datetime(3)', 'mysql/datetime@1', { precision: 3 }, 'DEFAULT (CURRENT_TIMESTAMP(3))'],
    [
      'timestamp(6)',
      'mysql/timestamp-temporal@1',
      { precision: 6 },
      'DEFAULT (CURRENT_TIMESTAMP(6))',
    ],
    ['date', 'mysql/date-string@1', undefined, 'DEFAULT (CURRENT_DATE)'],
    ['time(6)', 'mysql/time-string@1', { precision: 6 }, 'DEFAULT (CURRENT_TIME(6))'],
    ['time', 'mysql/time-temporal@1', undefined, 'DEFAULT (CURRENT_TIME)'],
    ['varchar(191)', 'sql/varchar@1', { length: 191 }, 'DEFAULT (CURRENT_TIMESTAMP)'],
  ])(
    'writes now() on a %s column of %s as the current value it holds',
    async (type, codecId, typeParams, clause) => {
      const column = col('c', type, {
        default: fn('now()'),
        codecRef: { codecId, ...(typeParams === undefined ? {} : { typeParams }) },
      } as never);
      expect(await adapter.renderColumnDefault(column, 't')).toBe(clause);
    },
  );

  it.each([
    ['int', 'mysql/int@1', 'mysql/int'],
    ['text', 'mysql/duration-string@1', 'mysql/duration'],
  ])(
    'refuses now() on a %s column of %s, which holds no date or time',
    async (type, codecId, dataType) => {
      const column = col('c', type, { default: fn('now()'), codecRef: { codecId } } as never);
      await expect(adapter.renderColumnDefault(column, 't')).rejects.toThrow(
        expect.objectContaining({
          code: 'CONTRACT.DEFAULT_INVALID',
          meta: { table: 't', column: 'c', dataType, reason: 'now-default-not-date-or-time' },
        }),
      );
    },
  );

  it.each([
    ['date', 'mysql/date-string@1', undefined, '2024-02-29', "DEFAULT '2024-02-29'"],
    ['time(6)', 'mysql/time-string@1', { precision: 6 }, '09:30:00', "DEFAULT '09:30:00'"],
    [
      'timestamp(3)',
      'mysql/timestamp@1',
      { precision: 3 },
      '2024-01-01T00:00:00.5',
      "DEFAULT '2024-01-01 00:00:00.500'",
    ],
    ['text', 'mysql/duration-string@1', undefined, 'PT1H30M', "DEFAULT ('PT1H30M')"],
  ])(
    'writes a literal default on a %s column of %s through its codec',
    async (type, codecId, typeParams, value, clause) => {
      const column = col('c', type, {
        default: lit(value),
        codecRef: { codecId, ...(typeParams === undefined ? {} : { typeParams }) },
      } as never);
      expect(await adapter.renderColumnDefault(column, 't')).toBe(clause);
    },
  );

  it('reads a literal through the column codec', async () => {
    const column = col('c', 'int', {
      default: lit(5),
      codecRef: { codecId: 'mysql/int@1' },
    } as never);
    expect(await adapter.renderColumnDefault(column, 't')).toBe('DEFAULT 5');
  });

  it('refuses an unsafe expression default', async () => {
    await expect(render('int', { default: fn('1; DROP TABLE t') })).rejects.toThrow(
      /Unsafe default expression/,
    );
  });

  it.each([
    [true, '1'],
    [false, '0'],
    [12n, '12'],
    [new Date('2024-01-02T03:04:05.678Z'), "'2024-01-02 03:04:05.678'"],
    [new Uint8Array([1, 255]), "X'01ff'"],
    [{ a: 1 }, `'{"a":1}'`],
  ])('inlines %s as %s', (wire, literal) => {
    expect(mysqlInlineLiteral(wire, where)).toBe(literal);
  });

  it('refuses a value with no SQL literal', () => {
    expect(() => mysqlInlineLiteral(Number.POSITIVE_INFINITY, where)).toThrow(/finite number/);
    expect(() => mysqlInlineLiteral(Symbol('s'), where)).toThrow(/has no SQL literal/);
  });
});
