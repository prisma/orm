/**
 * What `contract infer` prints, `contract emit` reads back to the value the database reported.
 *
 * The printer writes the literal of a data type the column's own type takes; this parses the
 * printed schema with the real PSL parser and interprets it through the real codec descriptors, so
 * a literal that prints but does not read back fails here rather than in a user's terminal.
 */

import {
  type AuthoringTypeNamespace,
  collectScalarTypeConstructors,
} from '@internal/framework-components/authoring';
import { type CodecLookup, createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { type SqlColumnIRInput, SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../../src/core/authoring';
import { postgresDataTypeEntries } from '../../src/core/data-type-entries';
import { postgresDataTypes } from '../../src/core/data-types';
import { parsePostgresDefault } from '../../src/core/default-normalizer';
import { type PostgresSchema, postgresCreateNamespace } from '../../src/core/postgres-schema';
import { CODEC_ID_BY_PRINTED_TYPE } from '../../src/core/psl-infer/infer-default-codec';
import { postgresCodecRegistry } from '../../src/core/registry';
import { printPslFromFlat } from './fixtures';

/** The type constructors the printed schema names, bound to the codec `contract emit` resolves. */
const authoringTypes = {
  String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } },
  Boolean: { kind: 'typeConstructor', output: { codecId: 'pg/bool@1', nativeType: 'bool' } },
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
  SmallInt: { kind: 'typeConstructor', output: { codecId: 'pg/int2@1', nativeType: 'int2' } },
  BigInt: { kind: 'typeConstructor', output: { codecId: 'pg/int8@1', nativeType: 'int8' } },
  Float: { kind: 'typeConstructor', output: { codecId: 'pg/float8@1', nativeType: 'float8' } },
  Jsonb: { kind: 'typeConstructor', output: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' } },
  Timestamp: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/timestamp-temporal@1',
      nativeType: 'timestamp',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Numeric: {
    kind: 'typeConstructor',
    args: [
      { kind: 'number', name: 'precision', integer: true, minimum: 1, optional: true },
      { kind: 'number', name: 'scale', integer: true, minimum: 0, optional: true },
    ],
    output: {
      codecId: 'pg/numeric@1',
      nativeType: 'numeric',
      typeParams: { precision: { kind: 'arg', index: 0 }, scale: { kind: 'arg', index: 1 } },
    },
  },
} as const satisfies AuthoringTypeNamespace;

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      type: authoringTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      dataTypes: postgresDataTypeEntries(),
    },
  },
]);

const target = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
  authoring: { type: authoringTypes },
};

const codecLookup: CodecLookup = {
  get: (id) => postgresCodecRegistry.descriptorFor(id)?.factory({})({ name: id }),
  descriptorFor: (id) => postgresCodecRegistry.descriptorFor(id),
  targetTypesFor: (id) => postgresCodecRegistry.descriptorFor(id)?.targetTypes,
  renderOutputTypeFor: () => undefined,
};

function introspected(
  name: string,
  nativeType: string,
  rawDefault: string,
  shape: { readonly many?: true } = {},
): SqlColumnIRInput {
  const resolvedNativeType = shape.many ? `${nativeType}[]` : nativeType;
  return {
    name,
    nativeType,
    nullable: shape.many === true,
    default: rawDefault,
    ...ifDefined('many', shape.many),
    resolvedNativeType,
    ...ifDefined('resolvedDefault', parsePostgresDefault(rawDefault, resolvedNativeType)),
  };
}

/** The `default` each column carries after printing the schema and interpreting what was printed. */
function roundTrippedDefaults(columns: readonly SqlColumnIRInput[]) {
  const printed = printPslFromFlat(
    new SqlSchemaIR({
      tables: {
        account: {
          name: 'account',
          columns: Object.fromEntries(
            [{ name: 'id', nativeType: 'int4', nullable: false }, ...columns].map((column) => [
              column.name,
              column,
            ]),
          ),
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    }),
  );
  const { document, sources } = parse(printed, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  const emitted = interpretPslDocumentToSqlContract({
    documents: [document],
    symbolTable,
    sources,
    capabilities: { sql: { scalarList: true } },
    target,
    scalarColumnDescriptors: collectScalarTypeConstructors(authoringTypes),
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup,
    dataTypeLookup: createDataTypeLookup(postgresDataTypes),
    controlMutationDefaults: {
      defaultFunctionRegistry: new Map(),
      generatorDescriptors: [],
    },
  });
  if (!emitted.ok) {
    throw new Error(`${printed}\n\n${JSON.stringify(emitted.failure.diagnostics, null, 2)}`);
  }
  const storage = emitted.value.storage as SqlStorage;
  const namespace = storage.namespaces['public'] as PostgresSchema;
  return Object.fromEntries(
    Object.entries(namespace.entries.table?.['account']?.columns ?? {}).flatMap(([name, column]) =>
      column.default === undefined ? [] : [[name, column.default]],
    ),
  );
}

describe('a printed default reads back as the value the database reported', () => {
  it('round-trips every literal form the printer writes', () => {
    expect(
      roundTrippedDefaults([
        introspected('name', 'text', "'anonymous'::text"),
        introspected(
          'quoted',
          'text',
          `'he said "hi" \\ over
two lines é'::text`,
        ),
        introspected('small', 'int2', "'100'::integer"),
        introspected('count', 'int4', "'100000'::integer"),
        introspected('balance', 'int8', "'100000000000000099'::bigint"),
        introspected('price', 'numeric(10,2)', '1.50'),
        introspected('ratio', 'float8', "'NaN'::numeric"),
        introspected('active', 'bool', 'true'),
        introspected('meta', 'jsonb', `'{"plan": "free", "seats": 1}'::jsonb`),
        introspected('stamp', 'timestamp(3)', "'2024-01-01 00:00:00'::timestamp(3)"),
        introspected('scores', 'int4', "'{1,2}'::integer[]", { many: true }),
        introspected('docs', 'jsonb', `ARRAY['{}'::jsonb, '[]'::jsonb]`, { many: true }),
      ]),
    ).toEqual({
      name: { kind: 'literal', value: 'anonymous' },
      quoted: { kind: 'literal', value: 'he said "hi" \\ over\ntwo lines é' },
      small: { kind: 'literal', value: 100 },
      count: { kind: 'literal', value: 100000 },
      balance: { kind: 'literal', value: '100000000000000099' },
      price: { kind: 'literal', value: '1.50' },
      ratio: { kind: 'literal', value: 'NaN' },
      active: { kind: 'literal', value: true },
      meta: { kind: 'literal', value: { plan: 'free', seats: 1 } },
      stamp: { kind: 'literal', value: '2024-01-01 00:00:00' },
      scores: { kind: 'literal', value: [1, 2] },
      docs: { kind: 'literal', value: [{}, []] },
    });
  });

  it('prints a type constructor for every printed type name the round trip covers', () => {
    expect(
      Object.keys(authoringTypes).filter((name) => !CODEC_ID_BY_PRINTED_TYPE.has(name)),
    ).toEqual([]);
  });
});
