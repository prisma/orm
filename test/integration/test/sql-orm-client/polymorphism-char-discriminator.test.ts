import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import sqliteControlAdapter from '@internal/adapter-sqlite/control';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { enrichContract } from '@internal/cli/control-api';
import type { Contract } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import sqliteTargetControl, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { authorSqlContractFromPsl } from '../scalar-lists/psl-list-authoring';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

/**
 * A discriminator column of a fixed-length character type: Postgres pads a shorter value with spaces, so the ORM only finds the variant of a row by reading the column through its codec.
 */
function shapesSchema(kindType: string): string {
  return `
model Shape {
  id   Int @id
  kind ${kindType}
  name String

  @@discriminator(kind)
  @@map("shapes")
}

model Circle {
  radius Int?

  @@base(Shape, "circle")
}

model Box {
  side Int

  @@base(Shape, "box")
  @@map("boxes")
}
`;
}

type Shapes = Collection<Contract<SqlStorage>, string>;

async function roundTrip(shapes: Shapes) {
  await shapes.variant('circle' as never).create({ id: 1, name: 'wheel', radius: 3 } as never);
  await shapes.variant('box' as never).create({ id: 2, name: 'crate', side: 2 } as never);
  return {
    all: await shapes.orderBy((shape) => shape['id']!.asc()).all(),
    variantFieldsOnly: await shapes
      .select('id' as never, 'radius' as never, 'side' as never)
      .orderBy((shape) => shape['id']!.asc())
      .all(),
    boxes: await shapes.variant('box' as never).all(),
  };
}

const roundTripped = {
  all: [
    { id: 1, kind: 'circle', name: 'wheel', radius: 3 },
    { id: 2, kind: 'box', name: 'crate', side: 2 },
  ],
  variantFieldsOnly: [
    { id: 1, radius: 3 },
    { id: 2, side: 2 },
  ],
  boxes: [{ id: 2, kind: 'box', name: 'crate', side: 2 }],
};

describe('integration/polymorphism with a fixed-length character discriminator', () => {
  it(
    'creates each variant and reads it back on Postgres',
    async () => {
      const authored = await authorSqlContractFromPsl(shapesSchema('Char(6)'));
      expect(authored.diagnostics).toEqual([]);
      const contract = authored.contract!;
      const context = createExecutionContext({
        contract,
        stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
      });
      await withPushedContractRuntime(contract, async (runtime) => {
        const shapes = new Collection({ runtime, context }, 'Shape', { namespaceId: 'public' });
        expect(await roundTrip(shapes)).toEqual(roundTripped);
        expect(await runtime.query('select kind from shapes order by id')).toEqual([
          { kind: 'circle' },
          { kind: 'box   ' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it('creates each variant and reads it back on SQLite', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pn-char-discriminator-'));
    try {
      const { contract, namespaceId } = await authorSqliteContract(
        directory,
        shapesSchema('sql.Char(36)'),
      );
      const path = join(directory, 'test.db');
      const database = new DatabaseSync(path);
      database.exec(`
        create table shapes (
          id integer primary key,
          kind character(36) not null,
          name text not null,
          radius integer
        );
        create table boxes (
          id integer primary key references shapes(id),
          side integer not null
        );
      `);
      database.close();
      const stack = createSqlExecutionStack({
        target: sqliteTarget,
        adapter: sqliteAdapter,
        driver: sqliteDriver,
      });
      const context = createExecutionContext({ contract, stack });
      const instance = instantiateExecutionStack(stack);
      if (instance.adapter === undefined || instance.driver === undefined) {
        throw new InternalError('SQLite execution stack is missing its adapter or driver');
      }
      await instance.driver.connect({ kind: 'path', path });
      const runtime = new SqliteRuntimeImpl({
        context,
        adapter: instance.adapter,
        driver: instance.driver,
        closeRefusal: undefined,
      });
      try {
        const shapes = new Collection({ runtime, context }, 'Shape', { namespaceId });
        expect(await roundTrip(shapes as Shapes)).toEqual(roundTripped);
      } finally {
        await runtime.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

async function authorSqliteContract(directory: string, schema: string) {
  const stack = createControlStack({
    family: sql,
    target: sqliteTargetControl,
    adapter: sqliteControlAdapter,
  });
  const schemaPath = join(directory, 'schema.prisma');
  writeFileSync(schemaPath, `// use prisma-8\n${schema}`, 'utf-8');
  const result = await prismaContract(schemaPath, {
    target: sqlitePackRef,
    createNamespace: sqliteCreateNamespace,
  }).source.load({
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
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const contract = sql
    .create(stack)
    .deserializeContract(
      enrichContract(result.value, [sqliteTargetControl, sqliteControlAdapter]),
    ) as Contract<SqlStorage>;
  return { contract, namespaceId: stack.target.defaultNamespaceId };
}
