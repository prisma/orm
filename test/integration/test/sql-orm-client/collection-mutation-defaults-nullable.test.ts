import postgresAdapter from '@internal/adapter-postgres/control';
import postgresAdapterRuntime from '@internal/adapter-postgres/runtime';
import sqlFamilyControl from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresControl from '@internal/target-postgres/control';
import postgresPack from '@internal/target-postgres/pack';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { createMockRuntime, type MockRuntime } from './helpers';

const schema = `model Note {
  id       Int     @id
  title    String
  token    String? @onCreate(uuid())
  editedAt TimestamptzString? @onCreate(now()) @onUpdate(now())
}`;

function pslContract() {
  const stack = createControlStack({
    family: sqlFamilyControl,
    target: postgresControl,
    adapter: postgresAdapter,
  });
  const bound = bindPslSchema(schema, {
    sourceId: 'nullable-generated.prisma',
    context: contractSourceContextFromControlStack(stack),
  });
  const result = withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresPack,
      composedExtensionPackRefs: [],
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
  if (!result.ok) {
    throw new Error(JSON.stringify(result.failure.diagnostics));
  }
  const serializer = new PostgresContractSerializer();
  const json = JSON.parse(
    JSON.stringify(
      serializer.serializeContract(
        result.value as Parameters<typeof serializer.serializeContract>[0],
      ),
    ),
  );
  return serializer.deserializeContract({
    ...json,
    capabilities: { ...json.capabilities, returning: { enabled: true } },
  });
}

function setup() {
  const context = createExecutionContext({
    contract: pslContract(),
    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapterRuntime }),
  });
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Note', { namespaceId: 'public' });
  return { collection, runtime };
}

type ParamRef = { readonly value: unknown };
type Values = Readonly<Record<string, ParamRef>>;
type WriteAst = {
  readonly rows?: readonly Values[];
  readonly set?: Values;
  readonly onConflict?: { readonly action: { readonly set: Values } };
};

function astOf(runtime: MockRuntime): WriteAst {
  const [execution] = runtime.executions;
  if (execution === undefined) throw new Error('No statement was executed');
  return (execution.plan as { ast: WriteAst }).ast;
}

function valuesOf(values: Values | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([key, ref]) => [key, ref.value]));
}

const generatedToken = expect.stringMatching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const generatedTimestamp = expect.stringMatching(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
);
const row = { id: 1, title: 'a', token: null, editedAt: null };

describe('nullable generated fields from a PSL contract', () => {
  describe('create', () => {
    it('generates a value for a field that is left out', async () => {
      const { collection, runtime } = setup();
      runtime.setNextResults([[row]]);

      await collection.create({ id: 1, title: 'a' });

      expect(astOf(runtime).rows?.map(valuesOf)).toEqual([
        { id: 1, title: 'a', token: generatedToken, editedAt: generatedTimestamp },
      ]);
    });

    it('stores null for a field given as null', async () => {
      const { collection, runtime } = setup();
      runtime.setNextResults([[row]]);

      await collection.create({ id: 1, title: 'a', token: null, editedAt: null });

      expect(astOf(runtime).rows?.map(valuesOf)).toEqual([
        { id: 1, title: 'a', token: null, editedAt: null },
      ]);
    });
  });

  describe('createAll', () => {
    it('generates values for rows that leave the fields out and keeps null where given', async () => {
      const { collection, runtime } = setup();
      runtime.setNextResults([[row, { ...row, id: 2 }]]);

      await collection
        .createAll([
          { id: 1, title: 'a' },
          { id: 2, title: 'b', token: null, editedAt: null },
        ])
        .toArray();

      expect(astOf(runtime).rows?.map(valuesOf)).toEqual([
        { id: 1, title: 'a', token: generatedToken, editedAt: generatedTimestamp },
        { id: 2, title: 'b', token: null, editedAt: null },
      ]);
    });
  });

  describe('updateAll', () => {
    it('runs the update generator for a field that is left out', async () => {
      const { collection, runtime } = setup();
      runtime.setNextResults([[row]]);

      await collection.where({ id: 1 }).updateAll({ title: 'b' }).toArray();

      expect(valuesOf(astOf(runtime).set)).toEqual({ title: 'b', editedAt: generatedTimestamp });
    });

    it('stores null for a field given as null', async () => {
      const { collection, runtime } = setup();
      runtime.setNextResults([[row]]);

      await collection
        .where({ id: 1 })
        .updateAll({ title: 'b', token: null, editedAt: null })
        .toArray();

      expect(valuesOf(astOf(runtime).set)).toEqual({ title: 'b', token: null, editedAt: null });
    });
  });

  describe('upsert', () => {
    it('generates values for fields left out of either branch', async () => {
      const { collection, runtime } = setup();
      runtime.setNextResults([[row]]);

      await collection.upsert({
        create: { id: 1, title: 'a' },
        update: { title: 'b' },
        conflictOn: { id: 1 },
      });

      const ast = astOf(runtime);
      expect({
        create: ast.rows?.map(valuesOf),
        update: valuesOf(ast.onConflict?.action.set),
      }).toEqual({
        create: [{ id: 1, title: 'a', token: generatedToken, editedAt: generatedTimestamp }],
        update: { title: 'b', editedAt: generatedTimestamp },
      });
    });

    it('stores null for fields given as null in either branch', async () => {
      const { collection, runtime } = setup();
      runtime.setNextResults([[row]]);

      await collection.upsert({
        create: { id: 1, title: 'a', token: null, editedAt: null },
        update: { title: 'b', token: null, editedAt: null },
        conflictOn: { id: 1 },
      });

      const ast = astOf(runtime);
      expect({
        create: ast.rows?.map(valuesOf),
        update: valuesOf(ast.onConflict?.action.set),
      }).toEqual({
        create: [{ id: 1, title: 'a', token: null, editedAt: null }],
        update: { title: 'b', token: null, editedAt: null },
      });
    });
  });
});
