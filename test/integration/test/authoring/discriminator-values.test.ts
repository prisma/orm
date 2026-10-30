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

describe.each([
  {
    name: 'Postgres',
    stack: createControlStack({ family: sql, target: postgres, adapter: postgresAdapter }),
    pack: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    lengthLimited: 'VarChar(5)',
    notText: [
      ['Uuid', '"a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"'],
      ['Inet', '"10.0.0.1"'],
    ],
  },
  {
    name: 'SQLite',
    stack: createControlStack({ family: sql, target: sqlite, adapter: sqliteAdapter }),
    pack: sqlitePackRef,
    createNamespace: sqliteCreateNamespace,
    lengthLimited: undefined,
    notText: [['Int', '"1"']],
  },
])('@@base values on $name', ({ stack, pack, createNamespace, lengthLimited, notText }) => {
  const folders: string[] = [];
  afterAll(() => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  });

  async function author(kindType: string, values: readonly string[]) {
    const folder = mkdtempSync(join(tmpdir(), 'psl-discriminator-values-'));
    folders.push(folder);
    const schemaPath = join(folder, 'schema.prisma');
    const variants = values
      .map(
        (value, index) =>
          `model Variant${index} {\n  extra${index} Int?\n\n  @@base(Shape, ${value})\n}\n`,
      )
      .join('\n');
    writeFileSync(
      schemaPath,
      `// use prisma-8\n\nmodel Shape {\n  id   Int @id\n  kind ${kindType}\n\n  @@discriminator(kind)\n}\n\n${variants}`,
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

  async function refusals(kindType: string, values: readonly string[]) {
    const result = await author(kindType, values);
    if (result.ok) throw new Error('expected the schema to be refused');
    return result.failure.diagnostics.map(({ code, message, span }) => ({
      code,
      message,
      line: span?.start.line,
      columns: [span?.start.column, span?.end.column],
    }));
  }

  it('keys each variant of a String discriminator by its value', async () => {
    const result = await author('String', ['"circle"', '"box"']);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const shape = result.value.domain.namespaces[stack.target.defaultNamespaceId]?.models['Shape'];
    expect(shape?.variants).toEqual({
      circle: { model: 'Variant0', namespace: stack.target.defaultNamespaceId },
      box: { model: 'Variant1', namespace: stack.target.defaultNamespaceId },
    });
  });

  it('refuses a number at the value, as the attribute takes a string', async () => {
    expect(await refusals('String', ['4'])).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected a string literal',
        line: 13,
        columns: [17, 18],
      },
    ]);
  });

  it.skipIf(lengthLimited === undefined)(
    'refuses a value longer than the discriminator column holds, at the value',
    async () => {
      expect(await refusals(lengthLimited ?? '', ['"circle"'])).toEqual([
        {
          code: 'PSL_VALUE_REFUSED',
          message:
            'Field "Shape.kind": pg/varchar JSON value must be a string of at most 5 characters',
          line: 13,
          columns: [17, 25],
        },
      ]);
    },
  );

  it.each(notText)('refuses a %s discriminator, which is not text', async (kindType, value) => {
    expect(await refusals(kindType, [value])).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `Discriminator field "kind" on model "Shape" must be text, such as String, but is "${kindType}"`,
        line: 7,
        columns: [3, 24],
      },
    ]);
  });

  it('refuses two variants with the same value', async () => {
    expect(await refusals('String', ['"a"', '"a"'])).toEqual([
      {
        code: 'PSL_DUPLICATE_DISCRIMINATOR_VALUE',
        message:
          'Discriminator value "a" is used by both "Variant0" and "Variant1" on base model "Shape"',
        line: 19,
        columns: [3, 21],
      },
    ]);
  });
});
