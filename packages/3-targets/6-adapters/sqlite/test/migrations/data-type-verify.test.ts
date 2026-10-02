/**
 * Verify on SQLite compares the type text a column's data type renders with the text the catalog
 * reports. Each of the six data types is created by the planner, read back, and verified; and a
 * database whose integer and JSON defaults were written before their stored form changed still
 * verifies.
 */

import { DatabaseSync } from 'node:sqlite';
import {
  type ColumnDefault,
  type Contract,
  coreHash,
  type JsonValue,
  profileHash,
} from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import {
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  dataTypeId,
} from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumn } from '@internal/sql-contract/types';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../../src/core/control-adapter';
import {
  controlAdapter,
  emptySchema,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
} from './fixtures/runner-fixtures';

function createMemoryDriver() {
  const db = new DatabaseSync(':memory:');
  return {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const rows = db.prepare(sql).all(...((params ?? []) as Array<string | number | null>));
      return { rows: rows as Row[] };
    },
    async close() {
      db.close();
    },
  };
}

const literal = (value: Extract<ColumnDefault, { kind: 'literal' }>['value']): ColumnDefault => ({
  kind: 'literal',
  value,
});

const columns: Readonly<Record<string, StorageColumn>> = {
  text_col: {
    dataType: 'sqlite/text',
    codecId: 'sqlite/text@1',
    nullable: false,
    default: literal('x'),
  },
  integer_col: {
    dataType: 'sqlite/integer',
    codecId: 'sqlite/integer@1',
    nullable: false,
    default: literal('7'),
  },
  real_col: {
    dataType: 'sqlite/real',
    codecId: 'sqlite/real@1',
    nullable: false,
    default: literal(1.5),
  },
  blob_col: { dataType: 'sqlite/blob', codecId: 'sqlite/blob@1', nullable: true },
  character_col: {
    dataType: 'sqlite/character',
    codecId: 'sql/char@1',
    typeParams: { length: 36 },
    nullable: false,
    default: literal('a'),
  },
  character_varying_col: {
    dataType: 'sqlite/character-varying',
    codecId: 'sql/varchar@1',
    typeParams: { length: 255 },
    nullable: false,
    default: literal('b'),
  },
  json_col: {
    dataType: 'sqlite/text',
    codecId: 'sqlite/json@1',
    nullable: false,
    default: literal('{"a":1}'),
  },
  bigint_col: {
    dataType: 'sqlite/integer',
    codecId: 'sqlite/bigint@1',
    nullable: false,
    default: literal('9007199254740993'),
  },
};

const contract: Contract<SqlStorage> = {
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: profileHash('test'),
  storage: new SqlStorage({
    storageHash: coreHash('data-type-verify'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            item: {
              columns,
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      }),
    },
  }),
  roots: {},
  domain: applicationDomainOf({ models: {} }),
  capabilities: {},
  extensions: {},
  meta: {},
};

const introspector = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

function documentContractWith(body: StorageColumn): Contract<SqlStorage> {
  return {
    ...contract,
    storage: new SqlStorage({
      storageHash: coreHash('data-type-verify-json'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: { doc: { columns: { body }, uniques: [], indexes: [], foreignKeys: [] } },
          },
        }),
      },
    }),
  };
}

const documentContract = documentContractWith({
  dataType: 'sqlite/text',
  codecId: 'sqlite/json@1',
  nullable: false,
  default: literal('{"a":1,"b":[1,2]}'),
});

class LowerCaseCodec extends CodecImpl<'demo/lower-case@1', readonly ['equality'], string, string> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return String(json);
  }
}

/** An extension codec over `sqlite/text` whose values have a finer canonical form than the text type's. */
class LowerCaseDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = dataTypeId('sqlite/text');
  override readonly codecId = 'demo/lower-case@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override readonly toCanonicalForm = (value: JsonValue): JsonValue => String(value).toLowerCase();
  override factory(): (ctx: CodecInstanceContext) => LowerCaseCodec {
    return () => new LowerCaseCodec(this);
  }
}

const lowerCaseExtension = {
  kind: 'extension',
  id: 'demo-lower-case',
  familyId: 'sql',
  targetId: 'sqlite',
  version: '0.0.0',
  types: { codecTypes: { codecDescriptors: [new LowerCaseDescriptor()] } },
} satisfies TargetBoundComponentDescriptor<'sql', 'sqlite'>;

async function verify(driver: ReturnType<typeof createMemoryDriver>) {
  const schema = await introspector.introspect(driver);
  return familyInstance.verifySchema({
    contract,
    schema,
    strict: true,
    frameworkComponents,
  });
}

describe('verify on SQLite, for each data type', () => {
  it('verifies a table the planner created, as the database reports it', async () => {
    const driver = createMemoryDriver();
    try {
      const result = sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
        contract,
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract: null,
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      if (result.kind !== 'success') throw new Error('expected planner success');
      const operations = (await Promise.all(
        result.plan.operations,
      )) as SqlMigrationPlanOperation<unknown>[];
      const statements = operations.flatMap((operation) => operation.execute.map(({ sql }) => sql));
      for (const sql of statements) await driver.query(sql);

      expect(statements.join('\n')).toContain('"integer_col" INTEGER NOT NULL DEFAULT 7');
      expect(statements.join('\n')).toContain(
        '"bigint_col" INTEGER NOT NULL DEFAULT 9007199254740993',
      );
      expect(statements.join('\n')).toContain('"json_col" TEXT NOT NULL DEFAULT \'{"a":1}\'');

      const schema = await introspector.introspect(driver);
      expect(
        Object.fromEntries(
          Object.entries(schema.tables['item']?.columns ?? {}).map(([name, column]) => [
            name,
            column.nativeType,
          ]),
        ),
      ).toEqual({
        text_col: 'text',
        integer_col: 'integer',
        real_col: 'real',
        blob_col: 'blob',
        character_col: 'character',
        character_varying_col: 'character varying',
        json_col: 'text',
        bigint_col: 'integer',
      });
      expect((await verify(driver)).ok).toBe(true);
    } finally {
      await driver.close();
    }
  });

  it('verifies integer and JSON defaults written in their earlier stored form', async () => {
    const driver = createMemoryDriver();
    try {
      await driver.query(`CREATE TABLE "item" (
        "text_col" TEXT NOT NULL DEFAULT 'x',
        "integer_col" INTEGER NOT NULL DEFAULT 7,
        "real_col" REAL NOT NULL DEFAULT 1.5,
        "blob_col" BLOB,
        "character_col" CHARACTER NOT NULL DEFAULT 'a',
        "character_varying_col" CHARACTER VARYING NOT NULL DEFAULT 'b',
        "json_col" TEXT NOT NULL DEFAULT '{"a":1}',
        "bigint_col" INTEGER NOT NULL DEFAULT '9007199254740993'
      )`);
      expect(await verify(driver)).toMatchObject({ ok: true });
    } finally {
      await driver.close();
    }
  });

  it.each([
    ['keys in another order and extra spaces', `'{ "b" : [1, 2],  "a": 1 }'`, true],
    ['a different value', `'{"a":2,"b":[1,2]}'`, false],
  ])(
    'compares a JSON default written by hand with %s through the codec',
    async (_name, sqlDefault, ok) => {
      const driver = createMemoryDriver();
      try {
        await driver.query(`CREATE TABLE "doc" ("body" TEXT NOT NULL DEFAULT ${sqlDefault})`);
        const result = familyInstance.verifySchema({
          contract: documentContract,
          schema: await introspector.introspect(driver),
          strict: true,
          frameworkComponents,
        });
        expect(result.ok).toBe(ok);
      } finally {
        await driver.close();
      }
    },
  );

  it.each([
    ['in another form of the same value', `'ABC'`, true],
    ['with a different value', `'ABD'`, false],
  ])(
    'compares a default of an extension codec that declares a canonical form, written %s',
    async (_name, sqlDefault, ok) => {
      const driver = createMemoryDriver();
      try {
        await driver.query(`CREATE TABLE "doc" ("body" TEXT NOT NULL DEFAULT ${sqlDefault})`);
        const result = familyInstance.verifySchema({
          contract: documentContractWith({
            dataType: 'sqlite/text',
            codecId: 'demo/lower-case@1',
            nullable: false,
            default: literal('abc'),
          }),
          schema: await introspector.introspect(driver),
          strict: true,
          frameworkComponents: [...frameworkComponents, lowerCaseExtension],
        });
        expect(result.ok).toBe(ok);
      } finally {
        await driver.close();
      }
    },
  );

  it('verifies a JSON null document default against the stored text "null"', async () => {
    const driver = createMemoryDriver();
    try {
      await driver.query(`CREATE TABLE "doc" ("body" TEXT DEFAULT 'null')`);
      const result = familyInstance.verifySchema({
        contract: documentContractWith({
          dataType: 'sqlite/text',
          codecId: 'sqlite/json@1',
          nullable: true,
          default: literal('null'),
        }),
        schema: await introspector.introspect(driver),
        strict: true,
        frameworkComponents,
      });
      expect(result.ok).toBe(true);
    } finally {
      await driver.close();
    }
  });
});
