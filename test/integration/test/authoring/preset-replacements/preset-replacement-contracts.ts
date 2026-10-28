import mongoAdapter from '@internal/adapter-mongo/control';
import postgresAdapter from '@internal/adapter-postgres/control';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import { enrichContract } from '@internal/cli/control-api';
import type { ContractSourceDiagnostics } from '@internal/config/config-types';
import type { SerializeContract } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { defineContract as defineMongoContract } from '@internal/mongo/contract-builder';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { mongoContextInput } from '@internal/mongo-contract-psl/test';
import { defineContract as definePostgresContract } from '@internal/postgres/contract-builder';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { defineContract as defineSqliteContract } from '@internal/sqlite/contract-builder';
import { type MongoTargetContract, mongoTargetDescriptor } from '@internal/target-mongo/control';
import postgresControl from '@internal/target-postgres/control';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import sqliteControl, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePack from '@internal/target-sqlite/pack';
import { emit } from '../../../utils/emit';
import type {
  MongoHelpers,
  MongoRow,
  PostgresHelpers,
  PresetReplacementRow,
  SqliteHelpers,
  SqlRow,
} from './preset-replacement-rows';

export type Form = 'preset' | 'replacement';

const postgresStack = createControlStack({
  family: sql,
  target: postgresControl,
  adapter: postgresAdapter,
});
const sqliteStack = createControlStack({
  family: sql,
  target: sqliteControl,
  adapter: sqliteAdapter,
});
const mongoStack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
});

/** What interpreting a PSL schema gives: the contract, or the diagnostics that refused it. */
export type Interpreted =
  | { readonly ok: true; readonly value: Contract }
  | { readonly ok: false; readonly failure: ContractSourceDiagnostics };

function pslField<Helpers, Field>(row: PresetReplacementRow<Helpers, Field>, form: Form): string {
  const type = row.psl[form];
  if (type === undefined) throw new Error(`row ${row.model} has no PSL ${form}`);
  return type;
}

function sqlModel<Helpers>(row: SqlRow<Helpers>, form: Form): string {
  const type = pslField(row, form);
  const fields = row.id === true ? `  id ${type}` : `  id    Int @id\n  value ${type}`;
  return `model ${row.model} {\n${fields}\n}\n`;
}

function mongoModel(row: MongoRow, form: Form): string {
  return `model ${row.model} {\n  id    ObjectId @id @map("_id")\n  value ${pslField(row, form)}\n\n  @@map("${row.model}")\n}\n`;
}

/** The PSL schema with one model per row, each field written in `form`. */
export function sqlSchema<Helpers>(rows: readonly SqlRow<Helpers>[], form: Form): string {
  return rows.map((row) => sqlModel(row, form)).join('\n');
}

export function mongoSchema(rows: readonly MongoRow[], form: Form): string {
  return rows.map((row) => mongoModel(row, form)).join('\n');
}

export function interpretPostgres(schema: string): Interpreted {
  const bound = bindPslSchema(schema, {
    sourceId: 'preset-replacements.postgres.prisma',
    context: contractSourceContextFromControlStack(postgresStack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

export function interpretSqlite(schema: string): Interpreted {
  const bound = bindPslSchema(schema, {
    sourceId: 'preset-replacements.sqlite.prisma',
    context: contractSourceContextFromControlStack(sqliteStack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: sqlitePack,
      createNamespace: sqliteCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

export function interpretMongo(schema: string): Interpreted {
  const bound = bindPslSchema(schema, {
    sourceId: 'preset-replacements.mongo.prisma',
    context: contractSourceContextFromControlStack(mongoStack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToMongoContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...mongoContextInput(bound.context),
    }),
    bound.seedDiagnostics,
  );
}

/** The TypeScript contract with one model per row, each field written as its replacement. */
export function postgresTs(rows: readonly SqlRow<PostgresHelpers>[]): Contract {
  return definePostgresContract({}, (helpers) => ({
    models: Object.fromEntries(
      rows.map((row) => {
        const value = row.ts(helpers);
        const fields =
          row.id === true
            ? { id: value }
            : { id: helpers.field.column(helpers.type.Int()).id(), value };
        return [row.model, helpers.model(row.model, { fields }).sql({ table: row.model })];
      }),
    ),
  }));
}

export function sqliteTs(rows: readonly SqlRow<SqliteHelpers>[]): Contract {
  return defineSqliteContract({}, (helpers) => ({
    models: Object.fromEntries(
      rows.map((row) => {
        const value = row.ts(helpers);
        const fields =
          row.id === true
            ? { id: value }
            : { id: helpers.field.column(helpers.type.Int()).id(), value };
        return [row.model, helpers.model(row.model, { fields }).sql({ table: row.model })];
      }),
    ),
  }));
}

export function mongoTs(rows: readonly MongoRow[]): Contract {
  return defineMongoContract({}, (helpers: MongoHelpers) => ({
    models: Object.fromEntries(
      rows.map((row) => [
        row.model,
        helpers.model(row.model, {
          collection: row.model,
          fields: {
            id: helpers.field.objectId().mongo({ field: '_id' }),
            value: row.ts(helpers),
          },
        }),
      ]),
    ),
  }));
}

async function emitSql(
  contract: Contract,
  stack: typeof postgresStack | typeof sqliteStack,
  target: typeof postgresControl | typeof sqliteControl,
  adapter: typeof postgresAdapter | typeof sqliteAdapter,
): Promise<string> {
  type SerializerInput = Parameters<typeof target.contractSerializer.serializeContract>[0];
  const serializeContract: SerializeContract = (value) =>
    target.contractSerializer.serializeContract(value as SerializerInput);
  const normalized = sql
    .create(stack)
    .deserializeContract(serializeContract(enrichContract(contract, [target, adapter])));
  const emitted = await emit(normalized, stack, sql.emission, {
    serializeContract,
    ...sqlContractCanonicalizationHooks,
  });
  return emitted.contractJson;
}

/** The contract.json `prisma contract emit` writes for `contract`, hashes included. */
export function emitPostgres(contract: Contract): Promise<string> {
  return emitSql(contract, postgresStack, postgresControl, postgresAdapter);
}

export function emitSqlite(contract: Contract): Promise<string> {
  return emitSql(contract, sqliteStack, sqliteControl, sqliteAdapter);
}

export async function emitMongo(contract: Contract): Promise<string> {
  const serializeContract: SerializeContract = (value) =>
    mongoTargetDescriptor.contractSerializer.serializeContract(value as MongoTargetContract);
  const normalized = mongoFamilyDescriptor
    .create(mongoStack)
    .deserializeContract(enrichContract(contract, [mongoTargetDescriptor, mongoAdapter]));
  const emitted = await emit(normalized, mongoStack, mongoFamilyDescriptor.emission, {
    serializeContract,
    ...mongoContractCanonicalizationHooks,
  });
  return emitted.contractJson;
}
