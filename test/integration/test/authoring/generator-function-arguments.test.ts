import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import postgresAdapter from '@internal/adapter-postgres/control';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import sqlite from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

const FIELD_PREFIX = '  value String @onCreate(';

describe.each([
  {
    name: 'Postgres',
    stack: createControlStack({ family: sql, target: postgres, adapter: postgresAdapter }),
    pack: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    integer: 'pg/int4',
    fraction: 'pg/numeric',
    beyondInteger: {
      code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
      message: 'Expected a number that pg/int4 can hold; got pg/int8',
    },
  },
  {
    name: 'SQLite',
    stack: createControlStack({ family: sql, target: sqlite, adapter: sqliteAdapter }),
    pack: sqlitePackRef,
    createNamespace: sqliteCreateNamespace,
    integer: 'sqlite/integer',
    fraction: 'sqlite/real',
    beyondInteger: {
      code: 'PSL_INVALID_GENERATOR_ARGUMENT',
      message: 'nanoid: size must be between 2 and 255, got 3000000000',
    },
  },
])(
  'default function arguments on $name',
  ({ stack, pack, createNamespace, integer, fraction, beyondInteger }) => {
    const folders: string[] = [];
    afterAll(() => {
      for (const folder of folders) rmSync(folder, { recursive: true, force: true });
    });

    async function author(call: string) {
      const folder = mkdtempSync(join(tmpdir(), 'psl-default-args-'));
      folders.push(folder);
      const schemaPath = join(folder, 'schema.prisma');
      writeFileSync(
        schemaPath,
        `// use prisma-8\n\nmodel Row {\n  id Int @id\n${FIELD_PREFIX}${call})\n}\n`,
        'utf-8',
      );
      return prismaContract(schemaPath, { target: pack, createNamespace }).source.load({
        composedExtensions: [],
        defaultNamespaceId: stack.target.defaultNamespaceId,
        composedExtensionContracts: new Map(),
        authoringContributions: stack.authoringContributions,
        codecLookup: stack.codecLookup,
        dataTypes: stack.dataTypes,
        controlMutationDefaults: stack.controlMutationDefaults,
        generatorFunctions: stack.generatorFunctions,
        resolvedInputs: [schemaPath],
        capabilities: stack.capabilities,
      });
    }

    /** The diagnostics for `call`, each with the columns on the field's line it spans. */
    async function refusals(call: string) {
      const result = await author(call);
      if (result.ok) throw new Error(`expected ${call} to be refused`);
      return result.failure.diagnostics.map(({ code, message, span }) => ({
        code,
        message,
        line: span?.start.line,
        columns: [span?.start.column, span?.end.column],
      }));
    }

    /** The columns of `text` inside `call` on the field's line, as a diagnostic spans them. */
    function columnsOf(call: string, text: string) {
      const start = FIELD_PREFIX.length + call.indexOf(text) + 1;
      return [start, start + text.length];
    }

    it.each([
      ['nanoid(1000)', '1000', 'nanoid: size must be between 2 and 255, got 1000'],
      ['nanoid(1)', '1', 'nanoid: size must be between 2 and 255, got 1'],
      ['nanoid(256)', '256', 'nanoid: size must be between 2 and 255, got 256'],
      ['uuid(5)', '5', 'uuid: version must be 4 or 7, got 5'],
      ['cuid(1)', '1', 'cuid: version must be 2, got 1'],
    ])('refuses %s at the argument with the function message', async (call, argument, message) => {
      expect(await refusals(call)).toEqual([
        {
          code: 'PSL_INVALID_GENERATOR_ARGUMENT',
          message,
          line: 5,
          columns: columnsOf(call, argument),
        },
      ]);
    });

    it.each([
      ['nanoid(8.5)', '8.5'],
      ['nanoid(8.0)', '8.0'],
      ['uuid(4.0)', '4.0'],
      ['uuid(7.0)', '7.0'],
      ['cuid(2.0)', '2.0'],
    ])(
      'refuses %s at the argument, because a number with a fraction is not an integer',
      async (call, argument) => {
        expect(await refusals(call)).toEqual([
          {
            code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
            message: `Expected a number that ${integer} can hold; got ${fraction}`,
            line: 5,
            columns: columnsOf(call, argument),
          },
        ]);
      },
    );

    it('refuses nanoid(3000000000) at the argument, by the target integer type or by nanoid', async () => {
      expect(await refusals('nanoid(3000000000)')).toEqual([
        { ...beyondInteger, line: 5, columns: columnsOf('nanoid(3000000000)', '3000000000') },
      ]);
    });

    it('refuses a quoted string argument at the argument', async () => {
      expect(await refusals('nanoid("8")')).toEqual([
        {
          code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
          message: 'Expected a number; write 8',
          line: 5,
          columns: columnsOf('nanoid("8")', '"8"'),
        },
      ]);
    });

    it('names cuid as a generator function when its version is missing', async () => {
      expect(await refusals('cuid()')).toEqual([
        {
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Generator function "cuid" is missing required argument "version"',
          line: 5,
          columns: columnsOf('cuid()', 'cuid()'),
        },
      ]);
    });

    it('names nanoid as a generator function when it receives too many arguments', async () => {
      expect(await refusals('nanoid(8, 9)')).toEqual([
        {
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Generator function "nanoid" received too many positional arguments',
          line: 5,
          columns: columnsOf('nanoid(8, 9)', 'nanoid(8, 9)'),
        },
      ]);
    });

    it.each([
      ['uuid()', { kind: 'generator', id: 'uuidv4' }],
      ['uuid(4)', { kind: 'generator', id: 'uuidv4' }],
      ['uuid(7)', { kind: 'generator', id: 'uuidv7' }],
      ['cuid(2)', { kind: 'generator', id: 'cuid2' }],
      ['ulid()', { kind: 'generator', id: 'ulid' }],
      ['nanoid()', { kind: 'generator', id: 'nanoid' }],
      ['nanoid(2)', { kind: 'generator', id: 'nanoid', params: { size: 2 } }],
      ['nanoid(255)', { kind: 'generator', id: 'nanoid', params: { size: 255 } }],
    ])('lowers %s as before', async (call, onCreate) => {
      const result = await author(call);
      if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
      expect(result.value.execution?.mutations.defaults).toEqual([
        {
          ref: { namespace: stack.target.defaultNamespaceId, entry: 'Row', field: 'value' },
          onCreate,
        },
      ]);
    });
  },
);
