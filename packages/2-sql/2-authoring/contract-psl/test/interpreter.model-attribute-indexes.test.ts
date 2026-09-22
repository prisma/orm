/**
 * A contributed model attribute may lower to a table index instead of a
 * namespaced entity. The interpreter files it through the same path `@@index`
 * uses, so naming and validation are shared rather than duplicated.
 */
import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type { ModelAttributeSpecFactory } from '@internal/psl-parser';
import { fieldRef, list, modelAttribute, optional, str } from '@internal/psl-parser';
import { defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

/**
 * The contributed index goes through the target's index-type registration
 * like any other, so the test target has to register the method it names.
 */
const targetWithIndexTypes = {
  ...postgresTarget,
  indexTypes: defineIndexTypes().add('gin', { options: type('object') }),
};

const searchIndexSpecFactory: ModelAttributeSpecFactory = () =>
  modelAttribute('searchIndex', {
    documentation: 'Indexes one text column for full-text search.',
    positional: [
      {
        key: 'fields',
        type: list(fieldRef(), { allowEmpty: false, unique: true }),
        documentation: 'The single field to index.',
      },
    ],
    named: {
      name: { type: optional(str()), documentation: 'Wire-name prefix for the index.' },
    },
  });

type SearchIndexParsed = { readonly fields: readonly string[]; readonly name?: string };

function searchIndexContributions(repeatable?: boolean): AuthoringContributions {
  return {
    modelAttributes: {
      searchIndex: {
        kind: 'modelAttribute',
        attribute: 'searchIndex',
        spec: searchIndexSpecFactory,
        ...(repeatable === undefined ? {} : { repeatable }),
        lower: (parsed: SearchIndexParsed, ctx) => {
          const field = parsed.fields[0];
          if (field === undefined) return undefined;
          const storageName = ctx.fieldStorageName(field);
          if (storageName === undefined) return undefined;
          return {
            index: {
              expression: `to_tsvector('english', "${storageName}")`,
              type: 'gin',
              // `undefined`, not `{}`: the string form leaves `options`
              // absent when the author writes none, and an empty bag would
              // make the two forms differ in the emitted contract.
              options: undefined,
              where: undefined,
              unique: undefined,
              map: undefined,
              name: parsed.name,
            },
          };
        },
      },
    },
  };
}

function interpret(schema: string, authoringContributions?: AuthoringContributions) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({
    ...document,
    target: targetWithIndexTypes,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: builtinControlMutationDefaults,
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    ...(authoringContributions !== undefined ? { authoringContributions } : {}),
  });
}

function indexesOf(schema: string, authoringContributions?: AuthoringContributions) {
  const result = interpret(schema, authoringContributions);
  expect(result.ok).toBe(true);
  if (!result.ok) return [];
  return unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Message']!.indexes;
}

describe('a contributed model attribute that lowers to an index', () => {
  it('produces the same index as the equivalent @@index(expression:)', () => {
    const contributed = indexesOf(
      `model Message {
  id Int @id
  text String
  @@searchIndex([text], name: "message_text_search")
}`,
      searchIndexContributions(),
    );

    const authored = indexesOf(
      `model Message {
  id Int @id
  text String
  @@index(expression: "to_tsvector('english', \\"text\\")", type: "gin", name: "message_text_search")
}`,
    );

    expect(contributed).toEqual(authored);
    expect(contributed).toHaveLength(1);
  });

  it('renders the storage column name of a renamed field, not the field name', () => {
    const indexes = indexesOf(
      `model Message {
  id Int @id
  text String @map("body_text")
  @@searchIndex([text], name: "message_text_search")
}`,
      searchIndexContributions(),
    );

    expect(indexes[0]).toMatchObject({
      expression: `to_tsvector('english', "body_text")`,
    });
  });

  it('files two indexes when the descriptor is repeatable', () => {
    const indexes = indexesOf(
      `model Message {
  id Int @id
  text String
  summary String
  @@searchIndex([text], name: "message_text_search")
  @@searchIndex([summary], name: "message_summary_search")
}`,
      searchIndexContributions(true),
    );

    expect(indexes.map((index) => index.prefix)).toEqual([
      'message_text_search',
      'message_summary_search',
    ]);
  });

  it('still rejects a duplicate when the descriptor is not repeatable', () => {
    const result = interpret(
      `model Message {
  id Int @id
  text String
  summary String
  @@searchIndex([text], name: "message_text_search")
  @@searchIndex([summary], name: "message_summary_search")
}`,
      searchIndexContributions(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_DUPLICATE_ATTRIBUTE',
          message: '`@@searchIndex` declared more than once on model "Message".',
        }),
      ]),
    );
  });
});
